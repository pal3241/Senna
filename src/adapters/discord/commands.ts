import { SlashCommandBuilder } from "discord.js";

export const senaCommand = new SlashCommandBuilder()
  .setName("sena")
  .setDescription("Inspect and safely control the Sena Minecraft agent")
  .addSubcommand((command) =>
    command.setName("status").setDescription("Show runtime and task status"),
  )
  .addSubcommand((command) =>
    command
      .setName("task")
      .setDescription("Queue a goal for Sena")
      .addStringOption((option) =>
        option
          .setName("objective")
          .setDescription("What Sena should accomplish")
          .setRequired(true)
          .setMaxLength(2000),
      ),
  )
  .addSubcommand((command) =>
    command.setName("tasks").setDescription("List recent tasks"),
  )
  .addSubcommand((command) =>
    command
      .setName("cancel")
      .setDescription("Cancel a task safely")
      .addStringOption((option) =>
        option
          .setName("task_id")
          .setDescription("Task UUID")
          .setRequired(true)
          .setMaxLength(36),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("pause")
      .setDescription("Pause new work and cancel active actions safely"),
  )
  .addSubcommand((command) =>
    command.setName("resume").setDescription("Resume after state validation"),
  )
  .addSubcommand((command) =>
    command
      .setName("stop")
      .setDescription("Emergency stop active actions and enter SAFE_HALT"),
  )
  .addSubcommand((command) =>
    command.setName("inventory").setDescription("Show observed inventory"),
  )
  .addSubcommand((command) =>
    command
      .setName("inspect")
      .setDescription("Show the current structured world observation"),
  )
  .addSubcommand((command) =>
    command.setName("modules").setDescription("Show loaded module status"),
  )
  .addSubcommand((command) =>
    command.setName("health").setDescription("Show component health"),
  )
  .addSubcommand((command) =>
    command
      .setName("config")
      .setDescription("Show safe non-secret configuration"),
  )
  .addSubcommand((command) =>
    command
      .setName("memory")
      .setDescription("Query learned memories")
      .addStringOption((option) =>
        option
          .setName("query")
          .setDescription("Question to search")
          .setRequired(true)
          .setMaxLength(500),
      ),
  )
  .addSubcommand((command) =>
    command
      .setName("learning")
      .setDescription("Show evaluated learning summaries"),
  );
