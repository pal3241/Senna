import { EventEmitter } from "node:events";
import { logger } from "./logger.js";

export type SenaEventMap = {
  "task.created": { taskId: string; source: string };
  "task.changed": { taskId: string; status: string };
  "runtime.safe-halt": { reason: string };
  "minecraft.health": { health: number; observedAt: string };
  "minecraft.death": {
    occurredAt: string;
    position: { x: number; y: number; z: number } | null;
    health: number | null;
    cause: "unknown";
  };
  "runtime.connection": {
    adapter: "minecraft" | "discord";
    status: string;
  };
};

export const senaEventNames = [
  "task.created",
  "task.changed",
  "runtime.safe-halt",
  "runtime.connection",
  "minecraft.health",
  "minecraft.death",
] as const satisfies readonly (keyof SenaEventMap)[];

type Listener<T> = (payload: T) => void | Promise<void>;

export class SenaEventBus {
  private readonly emitter = new EventEmitter();

  on<K extends keyof SenaEventMap>(
    event: K,
    listener: Listener<SenaEventMap[K]>,
  ): () => void {
    const safeListener = (payload: SenaEventMap[K]) => {
      try {
        const result = listener(payload);
        if (result && typeof result.then === "function") {
          void result.catch((error: unknown) =>
            this.reportListenerError(event, error),
          );
        }
      } catch (error) {
        this.reportListenerError(event, error);
      }
    };
    this.emitter.on(event, safeListener);
    return () => this.emitter.off(event, safeListener);
  }

  once<K extends keyof SenaEventMap>(
    event: K,
    listener: Listener<SenaEventMap[K]>,
  ): () => void {
    const cleanup = this.on(event, (payload) => {
      cleanup();
      return listener(payload);
    });
    return cleanup;
  }

  emit<K extends keyof SenaEventMap>(event: K, payload: SenaEventMap[K]): void {
    this.emitter.emit(event, payload);
  }

  removeAllListeners(): void {
    this.emitter.removeAllListeners();
  }

  private reportListenerError(event: keyof SenaEventMap, error: unknown): void {
    logger.error({ event, err: error }, "Runtime event listener failed");
  }
}
