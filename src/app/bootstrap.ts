import "dotenv/config";
import { DiscordAdapter } from "../adapters/discord/discord-adapter.js";
import { loadConfig } from "../core/config.js";
import { NvidiaNimProvider } from "../ai/llm/nvidia-nim-provider.js";
import { Planner } from "../ai/planning/planner.js";
import { MinecraftAdapter } from "../adapters/minecraft/minecraft-adapter.js";
import { SenaEventBus } from "../core/event-bus.js";
import { Health } from "../core/health.js";
import { logger } from "../core/logger.js";
import { NotificationOutbox } from "../core/notification-outbox.js";
import { RuntimeControls } from "../core/runtime-controls.js";
import { discoverModules } from "../core/modules/discovery.js";
import { ModuleHost } from "../core/modules/module-host.js";
import { TaskRepository } from "../core/tasks/task-repository.js";
import { ActionCoordinator } from "../execution/action-coordinator.js";
import { Database } from "../storage/database.js";
import { join, resolve } from "node:path";

export interface Runtime {
  readonly health: Health;
  readonly events: SenaEventBus;
  readonly tasks: TaskRepository;
  readonly modules: ModuleHost;
  readonly minecraft: MinecraftAdapter;
  readonly actions: ActionCoordinator;
  readonly controls: RuntimeControls;
  readonly discord: DiscordAdapter;
  readonly planner: Planner | null;
  start(): Promise<void>;
  stop(signal?: string): Promise<void>;
}

export async function bootstrap(): Promise<Runtime> {
  const config = loadConfig();
  const planner =
    config.AI_LLM_PROVIDER === "nvidia-nim"
      ? new Planner(
          new NvidiaNimProvider({
            apiKey: config.NVIDIA_NIM_LLM_API_KEY,
            model: config.NVIDIA_NIM_LLM_MODEL,
            ...(config.NVIDIA_NIM_LLM_BASE_URL
              ? { baseUrl: config.NVIDIA_NIM_LLM_BASE_URL }
              : {}),
          }),
        )
      : null;
  const health = new Health();
  const events = new SenaEventBus();
  const databasePath =
    config.SENA_DATA_DIR === ":memory:"
      ? ":memory:"
      : join(resolve(config.SENA_DATA_DIR), "sena.sqlite");
  const database = new Database(databasePath);
  const tasks = new TaskRepository(database.connection, events);
  const outbox = new NotificationOutbox(database.connection);
  const controls = new RuntimeControls(database.connection);
  const modules = new ModuleHost(events, logger, { mode: config.SENA_MODE });
  const minecraft = new MinecraftAdapter(config, health, events);
  const actions = new ActionCoordinator({
    onSafeHalt: (reason) => {
      health.update({ mode: "SAFE_HALT" });
      try {
        controls.setSafeHalt(reason);
      } catch (error) {
        logger.error({ err: error }, "Could not persist SAFE_HALT state");
      }
      events.emit("runtime.safe-halt", { reason });
    },
  });
  const discord = new DiscordAdapter({
    config,
    events,
    outbox,
    health,
    controls,
    tasks,
    modules,
    actions,
    minecraft,
  });
  const runtime: Runtime = {
    health,
    events,
    tasks,
    modules,
    minecraft,
    actions,
    controls,
    discord,
    planner,
    async start() {
      const interrupted = tasks.recoverActiveTasks();
      try {
        const catalog = await discoverModules({
          modulesDirectory: resolve(config.SENA_MODULES_DIR),
          trustedModuleIds: new Set(config.SENA_TRUSTED_MODULE_IDS),
          builtinModuleIds: new Set(["basic"]),
        });
        for (const module of catalog.modules) {
          if (module.reason) {
            logger.info(
              {
                moduleId: module.manifest?.id ?? module.directory,
                status: module.status,
                reason: module.reason,
              },
              "Module not activated",
            );
          }
        }
        await modules.start(catalog.loadOrder);
      } catch (error) {
        logger.error(
          { err: error },
          "Module discovery failed; core will continue without modules",
        );
      }
      minecraft.start();
      const controlState = controls.get();
      actions.setPaused(controlState.paused);
      if (controlState.safeHaltReason)
        actions.halt(controlState.safeHaltReason);
      void discord.start().catch((error: unknown) => {
        logger.error(
          { err: error },
          "Discord adapter startup failed; core will continue",
        );
      });
      health.update({ lifecycle: "running" });
      logger.info(
        {
          mode: config.SENA_MODE,
          recoveredTasks: interrupted,
          loadedModules: modules.getStatus().length,
        },
        "Sena core started",
      );
    },
    async stop(signal = "requested") {
      if (health.get().lifecycle === "stopped") return;
      health.update({ lifecycle: "stopping" });
      logger.info({ signal }, "Sena is shutting down");
      await actions.stop();
      await modules.stopAll();
      await minecraft.stop();
      await discord.stop();
      database.close();
      events.removeAllListeners();
      health.update({ lifecycle: "stopped" });
    },
  };
  return runtime;
}
