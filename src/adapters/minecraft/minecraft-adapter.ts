import type { Bot } from "mineflayer";
import type { AppConfig } from "../../core/config.js";
import type { SenaEventBus } from "../../core/event-bus.js";
import type { Health } from "../../core/health.js";
import { logger } from "../../core/logger.js";
import { ConnectionManager } from "./connection-manager.js";
import { PluginRegistry } from "./plugin-registry.js";
import { WorldObserver, type WorldSnapshot } from "./world-observer.js";

export class MinecraftAdapter {
  private readonly plugins = new PluginRegistry();
  private readonly connection: ConnectionManager;
  private readonly worldObserver: WorldObserver;

  constructor(
    private readonly config: AppConfig,
    private readonly health: Health,
    private readonly events: SenaEventBus,
  ) {
    this.connection = new ConnectionManager(
      {
        host: config.MINECRAFT_HOST,
        port: config.MINECRAFT_PORT,
        username: config.MINECRAFT_USERNAME,
        auth: config.MINECRAFT_AUTH,
        version: config.MINECRAFT_VERSION,
      },
      this.plugins,
      {
        onState: (state) => {
          this.health.update({
            minecraft: state,
            ...(state === "spawned"
              ? { mode: "OFFLINE_AI" as const }
              : { mode: "DISCONNECTED_MINECRAFT" as const }),
          });
          this.events.emit("runtime.connection", {
            adapter: "minecraft",
            status: state,
          });
        },
        onSpawn: () => {
          this.events.emit("runtime.connection", {
            adapter: "minecraft",
            status: "spawned",
          });
        },
        onHealth: (healthValue) => {
          this.events.emit("minecraft.health", {
            health: healthValue,
            observedAt: new Date().toISOString(),
          });
        },
        onDeath: () => {
          const snapshot = this.worldObserver.snapshot();
          this.events.emit("minecraft.death", {
            occurredAt: new Date().toISOString(),
            position: snapshot.position.value,
            health: snapshot.health.value,
            cause: "unknown",
          });
        },
      },
      logger,
    );
    this.worldObserver = new WorldObserver(() => this.connection.getBot());
  }

  start(): void {
    if (this.config.SENA_MODE !== "online") {
      this.health.update({ minecraft: "disabled" });
      return;
    }
    this.connection.start();
  }

  async stop(): Promise<void> {
    await this.connection.stop();
  }

  getBot(): Bot | null {
    return this.connection.getBot();
  }

  getWorldSnapshot(): WorldSnapshot {
    return this.worldObserver.snapshot();
  }

  getPluginStatus() {
    return this.plugins.getStatus();
  }
}
