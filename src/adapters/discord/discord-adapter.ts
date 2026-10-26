import {
  Client,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  escapeMarkdown,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { AppConfig } from "../../core/config.js";
import type { Health } from "../../core/health.js";
import type { SenaEventBus } from "../../core/event-bus.js";
import { logger, redactText } from "../../core/logger.js";
import type { NotificationOutbox } from "../../core/notification-outbox.js";
import type { RuntimeControls } from "../../core/runtime-controls.js";
import type { TaskRepository } from "../../core/tasks/task-repository.js";
import type { ModuleHost } from "../../core/modules/module-host.js";
import type { ActionCoordinator } from "../../execution/action-coordinator.js";
import type { MinecraftAdapter } from "../minecraft/minecraft-adapter.js";
import { senaCommand } from "./commands.js";
import { isAuthorized } from "./interaction-authorization.js";

export interface DiscordDependencies {
  config: AppConfig;
  events: SenaEventBus;
  outbox: NotificationOutbox;
  health: Health;
  controls: RuntimeControls;
  tasks: TaskRepository;
  modules: ModuleHost;
  actions: ActionCoordinator;
  minecraft: MinecraftAdapter;
}

const responseLimit = 1800;
const cooldownMs = 2500;

export class DiscordAdapter {
  private client: Client | null = null;
  private readonly cooldowns = new Map<string, number>();
  private readonly eventCleanups: Array<() => void> = [];
  private flushing = false;
  private warnedNoAlertsChannel = false;
  private stopping = false;

  constructor(private readonly dependencies: DiscordDependencies) {
    this.eventCleanups.push(
      dependencies.events.on("runtime.safe-halt", ({ reason }) => {
        this.queueNotification(
          `safe-halt:${Math.floor(Date.now() / 300_000)}`,
          `Sena entered SAFE_HALT: ${reason}`,
        );
      }),
      dependencies.events.on("minecraft.death", ({ occurredAt, cause }) => {
        this.queueNotification(
          `death:${occurredAt}`,
          `Minecraft death observed at ${occurredAt}; cause: ${cause}.`,
        );
      }),
      dependencies.events.on("runtime.connection", ({ adapter, status }) => {
        if (status === "failed" || status === "disconnected") {
          this.queueNotification(
            `${adapter}:${status}:${Math.floor(Date.now() / 300_000)}`,
            `${adapter} connection status: ${status}.`,
          );
        }
      }),
      dependencies.events.on("task.changed", ({ taskId, status }) => {
        if (
          status === "failed" ||
          status === "blocked" ||
          status === "succeeded"
        ) {
          this.queueNotification(
            `task:${taskId}:${status}`,
            `Task ${taskId} is ${status}.`,
          );
        }
      }),
    );
  }

  async start(): Promise<void> {
    this.stopping = false;
    const { config, health } = this.dependencies;
    if (!config.DISCORD_BOT_TOKEN) {
      health.update({ discord: "disabled" });
      return;
    }
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    this.client = client;
    client.once("ready", () => {
      if (this.stopping) return;
      health.update({ discord: "connected" });
      logger.info({ userId: client.user?.id }, "Discord adapter connected");
      void this.registerCommands(client);
      void this.flushNotifications();
    });
    client.on("shardDisconnect", () =>
      health.update({ discord: "disconnected" }),
    );
    client.on("shardResume", () => health.update({ discord: "connected" }));
    client.on("interactionCreate", (interaction) => {
      if (
        !interaction.isChatInputCommand() ||
        interaction.commandName !== "sena"
      )
        return;
      void this.handleCommand(interaction).catch((error: unknown) => {
        logger.error({ err: error }, "Discord command failed");
        if (interaction.deferred || interaction.replied) {
          void interaction
            .editReply({
              content:
                "Sena could not complete that command. Check the private runtime logs.",
            })
            .catch(() => undefined);
        } else {
          void interaction
            .reply({
              content: "Sena could not complete that command.",
              flags: MessageFlags.Ephemeral,
            })
            .catch(() => undefined);
        }
      });
    });
    client.on("error", (error) => {
      health.update({ discord: "failed" });
      logger.error({ err: error }, "Discord client error");
    });
    try {
      await client.login(config.DISCORD_BOT_TOKEN);
    } catch (error) {
      if (!this.stopping) {
        health.update({ discord: "failed" });
        logger.error(
          { err: error },
          "Discord login failed; core runtime will continue",
        );
      }
      client.destroy();
      this.client = null;
    }
  }

  async stop(): Promise<void> {
    this.stopping = true;
    for (const cleanup of this.eventCleanups.splice(0)) cleanup();
    this.client?.destroy();
    this.client = null;
    this.dependencies.health.update({ discord: "disconnected" });
  }

  private queueNotification(dedupeKey: string, message: string): void {
    try {
      this.dependencies.outbox.enqueue(dedupeKey, message);
      if (this.client?.isReady()) void this.flushNotifications();
    } catch (error) {
      logger.error({ err: error }, "Could not queue Discord notification");
    }
  }

  private async flushNotifications(): Promise<void> {
    const client = this.client;
    const channelId = this.dependencies.config.DISCORD_ALERTS_CHANNEL_ID;
    if (!client?.isReady() || this.flushing) return;
    if (!channelId) {
      if (!this.warnedNoAlertsChannel) {
        logger.info(
          "Discord alert outbox is waiting for DISCORD_ALERTS_CHANNEL_ID",
        );
        this.warnedNoAlertsChannel = true;
      }
      return;
    }
    this.flushing = true;
    try {
      const channel = await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) {
        logger.warn(
          { channelId },
          "Configured Discord alerts channel is unavailable or not text based",
        );
        return;
      }
      for (const notification of this.dependencies.outbox.pending()) {
        try {
          await channel.send({
            content: sanitize(notification.payload),
            allowedMentions: { parse: [] },
          });
          this.dependencies.outbox.markSent(notification.id);
        } catch (error) {
          this.dependencies.outbox.markAttempt(notification.id);
          logger.warn(
            { err: error, attempts: notification.attempts + 1 },
            "Discord alert delivery failed; notification retained",
          );
          break;
        }
      }
    } catch (error) {
      logger.warn(
        { err: error },
        "Could not drain Discord notification outbox",
      );
    } finally {
      this.flushing = false;
    }
  }

  private async registerCommands(client: Client): Promise<void> {
    const { config } = this.dependencies;
    if (!config.DISCORD_REGISTER_COMMANDS) return;
    if (!config.DISCORD_GUILD_ID || !client.user) {
      logger.warn(
        "Command registration is enabled but DISCORD_GUILD_ID or application identity is unavailable",
      );
      return;
    }
    try {
      const rest = new REST({ version: "10" }).setToken(
        config.DISCORD_BOT_TOKEN,
      );
      await rest.put(
        Routes.applicationGuildCommands(
          client.user.id,
          config.DISCORD_GUILD_ID,
        ),
        {
          body: [senaCommand.toJSON()],
        },
      );
      logger.info(
        { guildId: config.DISCORD_GUILD_ID },
        "Sena slash commands registered",
      );
    } catch (error) {
      logger.error({ err: error }, "Discord command registration failed");
    }
  }

  private async handleCommand(
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    if (!isAuthorized(interaction, this.dependencies.config)) {
      await interaction.reply({
        content: "You are not authorized to control this Sena instance.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const previous = this.cooldowns.get(interaction.user.id) ?? 0;
    if (Date.now() - previous < cooldownMs) {
      await interaction.reply({
        content: "Please wait briefly before using another Sena command.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    this.cooldowns.set(interaction.user.id, Date.now());
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const output = await this.route(interaction);
    await interaction.editReply({ content: sanitize(output) });
  }

  private async route(
    interaction: ChatInputCommandInteraction,
  ): Promise<string> {
    const { health, tasks, modules, minecraft, actions, controls, config } =
      this.dependencies;
    const subcommand = interaction.options.getSubcommand();
    switch (subcommand) {
      case "status": {
        const snapshot = health.get();
        const queued = tasks.list("queued", 500).length;
        const active = actions.getActive();
        return [
          `Core: ${snapshot.lifecycle} · mode: ${snapshot.mode}`,
          `Minecraft: ${snapshot.minecraft} · Discord: ${snapshot.discord}`,
          `AI: LLM ${snapshot.llm} · VLM ${snapshot.vlm} · persistence ${snapshot.persistence}`,
          `Tasks queued: ${queued} · active action: ${active ? `${active.kind} (${active.taskId})` : "none"}`,
          `Paused: ${controls.get().paused} · modules loaded: ${modules.getStatus().length}`,
        ].join("\n");
      }
      case "task": {
        const objective = interaction.options
          .getString("objective", true)
          .trim();
        if (!objective || objective.length > 2000)
          return "Objective must contain 1–2000 characters.";
        const task = tasks.create({
          source: "discord",
          ownerId: interaction.user.id,
          goal: objective,
        });
        return `Queued task ${task.id} (priority ${task.priority}). Task execution is not enabled yet.`;
      }
      case "tasks": {
        const recent = tasks.list(undefined, 10);
        if (recent.length === 0) return "No tasks have been recorded.";
        return recent
          .map((task) => `${task.id} · ${task.status} · ${task.goal}`)
          .join("\n");
      }
      case "cancel": {
        const taskId = interaction.options.getString("task_id", true);
        const task = tasks.get(taskId);
        if (!task) return "Task not found.";
        if (["succeeded", "failed", "cancelled"].includes(task.status)) {
          return `Task is already ${task.status}.`;
        }
        if (task.status === "running")
          await actions.cancelTaskAndWait(task.id, "Cancelled from Discord");
        const cancelled = tasks.requestCancellation(task.id);
        return `Task ${cancelled.id} is ${cancelled.status}.`;
      }
      case "pause": {
        controls.setPaused(true);
        await actions.pauseAndCancel("Paused from Discord");
        for (const task of tasks.list(undefined, 500)) {
          if (
            [
              "queued",
              "planning",
              "ready",
              "running",
              "waiting",
              "interrupted",
            ].includes(task.status)
          ) {
            tasks.transition(task.id, "paused", "runtime-paused");
          }
        }
        return "Sena is paused. Active actions were cancelled and cleaned up.";
      }
      case "resume": {
        if (!actions.clearSafeHalt() && actions.isSafeHalted()) {
          return "Sena cannot resume while an action is still cleaning up. Try again shortly.";
        }
        actions.setPaused(false);
        controls.setPaused(false);
        controls.setSafeHalt(null);
        const connection = health.get().minecraft;
        health.update({
          mode:
            connection === "spawned" || connection === "disabled"
              ? "OFFLINE_AI"
              : "DISCONNECTED_MINECRAFT",
        });
        return "Sena resumed. Interrupted tasks still require world-state reconciliation.";
      }
      case "stop": {
        actions.halt("Emergency stop requested from Discord");
        await actions.waitForIdle();
        for (const task of tasks.list(undefined, 500)) {
          if (
            ["planning", "ready", "running", "waiting"].includes(task.status)
          ) {
            tasks.transition(task.id, "interrupted", "emergency-stop");
          }
        }
        return "SAFE_HALT is active. New actions are blocked until an authorized resume.";
      }
      case "inventory": {
        const inventory = minecraft.getWorldSnapshot().inventory;
        if (inventory.status === "unknown" || !inventory.value)
          return "Inventory is unknown until Minecraft is spawned.";
        return inventory.value.length
          ? inventory.value
              .map((item) => `${item.name}: ${item.count}`)
              .join("\n")
          : "Inventory is empty.";
      }
      case "inspect": {
        const world = minecraft.getWorldSnapshot();
        return [
          `Connection: ${world.connection}`,
          `Position: ${world.position.value ? `${world.position.value.x.toFixed(1)}, ${world.position.value.y.toFixed(1)}, ${world.position.value.z.toFixed(1)}` : "unknown"}`,
          `Health: ${world.health.value ?? "unknown"} · food: ${world.food.value ?? "unknown"}`,
          `Visible entities: ${world.entities.value?.length ?? "unknown"}`,
        ].join("\n");
      }
      case "modules": {
        const states = modules.getStatus();
        return states.length
          ? states
              .map(
                (module) =>
                  `${module.id} ${module.version}: ${module.health}${module.message ? ` (${module.message})` : ""}`,
              )
              .join("\n")
          : "No modules are loaded.";
      }
      case "health": {
        const snapshot = health.get();
        return Object.entries(snapshot)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n");
      }
      case "config":
        return [
          `Mode: ${config.SENA_MODE}`,
          `Minecraft auth: ${config.MINECRAFT_AUTH}`,
          `LLM provider: ${config.AI_LLM_PROVIDER}`,
          `VLM provider: ${config.AI_VLM_PROVIDER}`,
          `Module directory: ${config.SENA_MODULES_DIR}`,
          "Secrets and server credentials are never displayed.",
        ].join("\n");
      case "memory":
        return "Memory search is not available yet.";
      case "learning":
        return "Learning summaries are not available yet.";
      default:
        return "Unknown Sena command.";
    }
  }
}

function sanitize(text: string): string {
  return escapeMarkdown(redactText(text))
    .replaceAll("@", "@\u200b")
    .slice(0, responseLimit);
}
