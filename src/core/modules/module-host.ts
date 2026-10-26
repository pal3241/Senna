import { pathToFileURL } from "node:url";
import type { Logger } from "pino";
import {
  senaEventNames,
  type SenaEventBus,
  type SenaEventMap,
} from "../event-bus.js";
import { redactText } from "../logger.js";
import type { ModuleRecord } from "./discovery.js";

export type CapabilityHandler = (input: unknown) => unknown | Promise<unknown>;
export type ModuleHealth =
  "starting" | "ready" | "degraded" | "failed" | "stopped";

export interface ModuleRuntimeState {
  id: string;
  version: string;
  health: ModuleHealth;
  message: string | null;
}

export interface ModuleApi {
  readonly moduleId: string;
  readonly config: Readonly<{ mode: string }>;
  readonly logger: Logger;
  registerCapability(name: string, handler: CapabilityHandler): void;
  on<K extends keyof SenaEventMap>(
    event: K,
    listener: (payload: SenaEventMap[K]) => void | Promise<void>,
  ): () => void;
  setHealth(
    status: Exclude<ModuleHealth, "starting" | "failed" | "stopped">,
    message?: string,
  ): void;
}

export interface ModuleDefinition {
  start(api: ModuleApi): void | Promise<void>;
  stop?(): void | Promise<void>;
}

interface LoadedModule {
  record: ModuleRecord;
  definition: ModuleDefinition;
  cleanups: Array<() => void>;
  capabilities: Map<string, CapabilityHandler>;
  state: ModuleRuntimeState;
}

const supportedPermissions = new Set(["events.subscribe"]);
const shutdownTimeoutMs = 5_000;

export class ModuleHost {
  private readonly loaded = new Map<string, LoadedModule>();

  constructor(
    private readonly eventBus: SenaEventBus,
    private readonly logger: Logger,
    private readonly safeConfig: Readonly<{ mode: string }>,
  ) {}

  async start(records: readonly ModuleRecord[]): Promise<void> {
    for (const record of records) await this.load(record);
  }

  getStatus(): ModuleRuntimeState[] {
    return [...this.loaded.values()].map(({ state }) => ({ ...state }));
  }

  getCapability(name: string): CapabilityHandler | undefined {
    for (const module of this.loaded.values()) {
      const handler = module.capabilities.get(name);
      if (handler) return handler;
    }
    return undefined;
  }

  async stopAll(): Promise<void> {
    for (const module of [...this.loaded.values()].reverse())
      await this.stop(module);
  }

  private async load(record: ModuleRecord): Promise<void> {
    const manifest = record.manifest;
    if (
      record.status !== "compatible" ||
      !record.trusted ||
      !manifest ||
      !record.entryPath
    )
      return;
    if (!manifest.enabled_by_default) {
      this.logger.info(
        { moduleId: manifest.id },
        "Trusted module is disabled by its manifest",
      );
      return;
    }
    const unsupported = manifest.permissions.filter(
      (permission) => !supportedPermissions.has(permission),
    );
    if (unsupported.length > 0) {
      this.logger.warn(
        { moduleId: manifest.id, permissions: unsupported },
        "Module requests permissions unavailable in this runtime phase",
      );
      return;
    }
    const cleanups: Array<() => void> = [];
    const capabilities = new Map<string, CapabilityHandler>();
    const state: ModuleRuntimeState = {
      id: manifest.id,
      version: manifest.version,
      health: "starting",
      message: null,
    };
    const api: ModuleApi = {
      moduleId: manifest.id,
      config: this.safeConfig,
      logger: this.logger.child({ moduleId: manifest.id }),
      registerCapability: (name, handler) => {
        if (!manifest.capabilities.includes(name))
          throw new Error(`Capability ${name} was not declared in module.json`);
        if (capabilities.has(name))
          throw new Error(
            `Capability ${name} is already registered by this module`,
          );
        capabilities.set(name, handler);
      },
      on: (event, listener) => {
        if (!manifest.permissions.includes("events.subscribe"))
          throw new Error("Module lacks events.subscribe permission");
        if (!(senaEventNames as readonly string[]).includes(event)) {
          throw new Error(
            `Event ${String(event)} is not available in the module API`,
          );
        }
        const cleanup = this.eventBus.on(event, listener);
        cleanups.push(cleanup);
        return cleanup;
      },
      setHealth: (health, message) => {
        state.health = health;
        state.message = message ? redactText(message).slice(0, 500) : null;
      },
    };

    try {
      const moduleUrl = `${pathToFileURL(record.entryPath).href}?load=${Date.now()}`;
      const imported: unknown = await import(moduleUrl);
      const definition = getModuleDefinition(imported);
      await definition.start(api);
      if (state.health === "starting") state.health = "ready";
      this.loaded.set(manifest.id, {
        record,
        definition,
        cleanups,
        capabilities,
        state,
      });
      this.logger.info(
        {
          moduleId: manifest.id,
          version: manifest.version,
          capabilityCount: capabilities.size,
        },
        "Module started",
      );
    } catch (error) {
      for (const cleanup of cleanups) cleanup();
      state.health = "failed";
      state.message =
        error instanceof Error
          ? redactText(error.message).slice(0, 500)
          : "Module failed to start";
      this.logger.error(
        { moduleId: manifest.id, err: error },
        "Module startup failed; core will continue",
      );
    }
  }

  private async stop(module: LoadedModule): Promise<void> {
    module.state.health = "stopped";
    for (const cleanup of module.cleanups.splice(0).reverse()) cleanup();
    module.capabilities.clear();
    if (module.definition.stop) {
      let timeout: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.resolve(module.definition.stop()),
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Module stop timed out")),
              shutdownTimeoutMs,
            );
            timeout.unref();
          }),
        ]);
      } catch (error) {
        this.logger.error(
          { moduleId: module.record.manifest?.id, err: error },
          "Module shutdown failed",
        );
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    this.loaded.delete(module.record.manifest!.id);
  }
}

function getModuleDefinition(imported: unknown): ModuleDefinition {
  if (!imported || typeof imported !== "object")
    throw new Error("Module entry must export a module object as default");
  const definition = (imported as { default?: unknown }).default;
  if (
    !definition ||
    typeof definition !== "object" ||
    typeof (definition as { start?: unknown }).start !== "function"
  ) {
    throw new Error("Module default export must provide start(api)");
  }
  const stop = (definition as { stop?: unknown }).stop;
  if (stop !== undefined && typeof stop !== "function")
    throw new Error("Module stop export must be a function");
  return definition as ModuleDefinition;
}

export type ModuleEventKey = keyof SenaEventMap;
