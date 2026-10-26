import pathfinderPackage from "mineflayer-pathfinder";
import type {
  goals as PathfinderGoals,
  Movements,
} from "mineflayer-pathfinder";
import type { Bot } from "mineflayer";
import type { AppConfig } from "../../core/config.js";
import type { SenaEventBus } from "../../core/event-bus.js";
import type { Health } from "../../core/health.js";
import { logger } from "../../core/logger.js";
import { ConnectionManager, type BotFactory } from "./connection-manager.js";
import { PluginRegistry } from "./plugin-registry.js";
import { WorldObserver, type WorldSnapshot } from "./world-observer.js";

const { goals, Movements: PathfinderMovements } =
  pathfinderPackage as unknown as {
    goals: {
      GoalNear: new (
        x: number,
        y: number,
        z: number,
        range: number,
      ) => PathfinderGoals.GoalNear;
    };
    Movements: new (bot: Bot) => Movements;
  };

export class MinecraftAdapter {
  private readonly plugins = new PluginRegistry();
  private readonly connection: ConnectionManager;
  private readonly worldObserver: WorldObserver;
  private readonly movementPolicy: (bot: Bot) => Movements;

  constructor(
    private readonly config: AppConfig,
    private readonly health: Health,
    private readonly events: SenaEventBus,
    botFactory?: BotFactory,
    movementPolicy: (bot: Bot) => Movements = createSafeMovements,
  ) {
    this.movementPolicy = movementPolicy;
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
          this.health.update({ minecraft: state });
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
      botFactory,
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

  getWorldSnapshot(): WorldSnapshot {
    return this.worldObserver.snapshot();
  }

  isMovementReady(): boolean {
    return (
      this.connection.getState() === "spawned" &&
      this.plugins
        .getStatus()
        .some(
          (plugin) =>
            plugin.id === "mineflayer-pathfinder" && plugin.state === "ready",
        )
    );
  }

  async moveTo(
    target: { x: number; y: number; z: number },
    signal: AbortSignal,
  ): Promise<void> {
    if (
      !Number.isSafeInteger(target.x) ||
      !Number.isSafeInteger(target.y) ||
      !Number.isSafeInteger(target.z) ||
      Math.abs(target.x) > 30_000_000 ||
      target.y < -64 ||
      target.y > 320 ||
      Math.abs(target.z) > 30_000_000
    ) {
      throw new RangeError(
        "Minecraft move target is outside validated world bounds",
      );
    }
    const bot = this.connection.getBot();
    if (
      !bot ||
      this.connection.getState() !== "spawned" ||
      !bot.pathfinder ||
      !this.isMovementReady()
    ) {
      throw new Error("minecraft-movement-unavailable");
    }
    signal.throwIfAborted();
    bot.pathfinder.setMovements(this.movementPolicy(bot));
    let abortListener: (() => void) | undefined;
    let completed = false;
    let navigationError: unknown;
    try {
      const navigation = bot.pathfinder.goto(
        new goals.GoalNear(target.x, target.y, target.z, 1),
      );
      const aborted = new Promise<never>((_, reject) => {
        abortListener = () =>
          reject(
            signal.reason instanceof Error
              ? signal.reason
              : new Error("movement-cancelled"),
          );
        signal.addEventListener("abort", abortListener, { once: true });
        if (signal.aborted) abortListener();
      });
      await Promise.race([navigation, aborted]);
      completed = true;
    } catch (error) {
      navigationError = error;
      throw error;
    } finally {
      if (abortListener) signal.removeEventListener("abort", abortListener);
      if (!completed) {
        try {
          bot.pathfinder.stop();
        } catch (cleanupError) {
          // The coordinator's cleanup retries stop and safe-halts if it still fails.
          if (navigationError === undefined) throw cleanupError;
        }
      }
    }
  }

  stopMovement(): void {
    const bot = this.connection.getBot();
    if (bot?.pathfinder) bot.pathfinder.stop();
  }

  getPluginStatus() {
    return this.plugins.getStatus();
  }
}

function createSafeMovements(bot: Bot): Movements {
  const movements = new PathfinderMovements(bot);
  movements.canDig = false;
  movements.allowParkour = false;
  movements.allow1by1towers = false;
  movements.allowSprinting = false;
  movements.maxDropDown = 1;
  movements.scafoldingBlocks = [];
  return movements;
}
