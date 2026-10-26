# Discord setup and commands

The Discord adapter is optional. Leave `DISCORD_BOT_TOKEN` empty to run without Discord; Minecraft and persistence continue independently. The client requests only the `Guilds` intent and never forwards Minecraft chat to Discord or Discord text to Minecraft chat.

## Setup

1. Create a Discord application and bot, enable the `applications.commands` scope, and invite it to the intended guild.
2. Put its token in the local `.env` as `DISCORD_BOT_TOKEN`; never paste it into a command, task, module manifest, or chat.
3. Configure `DISCORD_OWNER_IDS` and/or `DISCORD_ADMIN_ROLE_IDS`. Set `DISCORD_GUILD_ID` and `DISCORD_COMMAND_CHANNEL_IDS` to limit where privileged commands work.
4. To publish the `/sena` command definition to one guild, set `DISCORD_REGISTER_COMMANDS=true` and `DISCORD_GUILD_ID`. Registration is disabled by default because it changes external Discord state.
5. Set `DISCORD_ALERTS_CHANNEL_ID` to enable delivery of queued alerts. Without it, alerts remain in SQLite until their 24-hour TTL expires.

All commands are ephemeral and require an authorized owner or admin role in an allowed guild/channel. A user cooldown is applied. Output is redacted, markdown escaped, and sent with mentions disabled.

## Commands

| Command                                         | Current behavior                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `/sena status`                                  | Runtime mode, component health, queued task count, active action, pause state, and loaded module count. |
| `/sena task objective:`                         | Persists a bounded task from the authorized Discord user. Task execution is not implemented yet.        |
| `/sena tasks`                                   | Lists up to ten recent tasks.                                                                           |
| `/sena cancel task_id:`                         | Cancels the task and waits for its active action cleanup when one is running.                           |
| `/sena pause`                                   | Persists pause state, cancels active actions, then pauses queued/in-progress tasks.                     |
| `/sena resume`                                  | Clears pause/safe halt when no action is cleaning up. Interrupted tasks still require reconciliation.   |
| `/sena stop`                                    | Cancels actions, waits for cleanup, persists `SAFE_HALT`, and marks active tasks interrupted.           |
| `/sena inventory`, `/sena inspect`              | Shows current Mineflayer observations or clearly reports unknown state.                                 |
| `/sena modules`, `/sena health`, `/sena config` | Shows loaded modules, runtime health, or an allowlisted non-secret config summary.                      |
| `/sena memory`, `/sena learning`                | Reports unavailable until those subsystems are implemented.                                             |

Important events use the SQLite notification outbox with deduplication and a 24-hour TTL. Discord disconnects do not stop task persistence, Minecraft connection handling, or the core process.
