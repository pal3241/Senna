import { createBot, type Bot } from "mineflayer";
import type { Logger } from "pino";
import { redactText } from "../../core/logger.js";
import { PluginRegistry } from "./plugin-registry.js";

export type MinecraftConnectionState =
  "disabled" | "disconnected" | "connecting" | "spawned" | "failed";

export interface MinecraftConnectionConfig {
  host: string;
  port: number;
  username: string;
  auth: "offline" | "microsoft";
  version: string;
}

export interface ConnectionCallbacks {
  onState(state: MinecraftConnectionState): void;
  onSpawn(bot: Bot): void;
  onHealth(health: number): void;
  onDeath(): void;
}

export type BotFactory = (config: MinecraftConnectionConfig) => Bot;

export class ConnectionManager {
  private bot: Bot | null = null;
  private state: MinecraftConnectionState = "disconnected";
  private reconnectTimer: NodeJS.Timeout | undefined;
  private connectionTimer: NodeJS.Timeout | undefined;
  private stableTimer: NodeJS.Timeout | undefined;
  private attempts = 0;
  private stopping = false;
  private reconnecting = false;

  constructor(
    private readonly config: MinecraftConnectionConfig,
    private readonly plugins: PluginRegistry,
    private readonly callbacks: ConnectionCallbacks,
    private readonly logger: Logger,
    private readonly factory: BotFactory = (options) =>
      createBot({
        host: options.host,
        port: options.port,
        username: options.username,
        auth: options.auth,
        ...(options.version ? { version: options.version } : {}),
      }),
    private readonly retryBaseMs = 1000,
    private readonly maximumRetries = 5,
    private readonly connectionTimeoutMs = 30_000,
  ) {}

  getState(): MinecraftConnectionState {
    return this.state;
  }

  getBot(): Bot | null {
    return this.bot;
  }

  start(): void {
    if (this.stopping)
      throw new Error("Minecraft connection manager has been stopped");
    if (this.bot || this.reconnectTimer) return;
    this.connect();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearTimers();
    const bot = this.bot;
    this.bot = null;
    if (bot) {
      this.plugins.stop(bot);
      try {
        bot.quit("Sena shutting down");
      } catch (error) {
        this.logger.warn(
          { err: error },
          "Minecraft client shutdown reported an error",
        );
      }
    }
    this.setState("disconnected");
  }

  private connect(): void {
    if (this.stopping) return;
    this.setState("connecting");
    let bot: Bot;
    try {
      bot = this.factory(this.config);
      this.bot = bot;
      this.plugins.load(bot);
    } catch (error) {
      this.logger.warn(
        { err: error },
        "Minecraft connection could not be created",
      );
      this.scheduleReconnect("create-failed");
      return;
    }

    this.connectionTimer = setTimeout(() => {
      if (this.bot !== bot || this.state === "spawned") return;
      this.logger.warn("Minecraft spawn timed out");
      this.plugins.stop(bot);
      try {
        bot.quit("Sena connection timeout");
      } catch (error) {
        this.logger.warn(
          { err: error },
          "Could not close timed out Minecraft client",
        );
      }
      this.scheduleReconnect("spawn-timeout");
    }, this.connectionTimeoutMs);
    this.connectionTimer.unref();

    bot.once("spawn", () => {
      if (this.bot !== bot || this.stopping) return;
      this.clearConnectionTimer();
      this.plugins.markReady();
      this.setState("spawned");
      this.callbacks.onSpawn(bot);
      this.stableTimer = setTimeout(() => {
        this.attempts = 0;
      }, 60_000);
      this.stableTimer.unref();
    });
    bot.on("health", () => {
      if (this.bot === bot && Number.isFinite(bot.health))
        this.callbacks.onHealth(bot.health);
    });
    bot.on("death", () => {
      if (this.bot === bot) this.callbacks.onDeath();
    });
    bot.on("error", (error) => {
      this.logger.warn(
        { errorMessage: redactText(error.message) },
        "Minecraft connection error",
      );
      this.scheduleReconnect("connection-error");
    });
    bot.on("kicked", () => {
      this.logger.warn("Minecraft server kicked the bot");
      this.scheduleReconnect("kicked");
    });
    bot.on("end", () => {
      if (!this.stopping) this.scheduleReconnect("connection-ended");
    });
  }

  private scheduleReconnect(reason: string): void {
    if (this.stopping || this.reconnectTimer || this.reconnecting) return;
    this.reconnecting = true;
    this.clearConnectionTimer();
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.stableTimer = undefined;
    const oldBot = this.bot;
    this.bot = null;
    if (oldBot) {
      this.plugins.stop(oldBot);
      try {
        oldBot.quit("Sena reconnecting");
      } catch (error) {
        this.logger.warn(
          { err: error },
          "Could not close disconnected Minecraft client",
        );
      }
    }
    this.attempts += 1;
    if (this.attempts > this.maximumRetries) {
      this.logger.error(
        { reason, attempts: this.attempts - 1 },
        "Minecraft reconnect limit reached",
      );
      this.setState("failed");
      this.reconnecting = false;
      return;
    }
    const delay = Math.min(this.retryBaseMs * 2 ** (this.attempts - 1), 30_000);
    this.logger.warn(
      { reason, attempt: this.attempts, retryInMs: delay },
      "Minecraft reconnect scheduled",
    );
    this.setState("disconnected");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnecting = false;
      this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }

  private setState(state: MinecraftConnectionState): void {
    if (state === this.state) return;
    this.state = state;
    this.callbacks.onState(state);
  }

  private clearConnectionTimer(): void {
    if (this.connectionTimer) clearTimeout(this.connectionTimer);
    this.connectionTimer = undefined;
  }

  private clearTimers(): void {
    this.clearConnectionTimer();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.stableTimer) clearTimeout(this.stableTimer);
    this.reconnectTimer = undefined;
    this.stableTimer = undefined;
  }
}
