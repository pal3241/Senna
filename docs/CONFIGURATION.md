# Configuration

Copy `.env.example` to `.env` and provide only values for integrations you enable. `.env` is ignored by Git. `npm run check` and offline mode require no tokens or Minecraft server.

| Variable                                                                                        | Purpose                                                                                                                                       |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `SENA_MODE`                                                                                     | `offline` by default; use `online` to enable Mineflayer connection.                                                                           |
| `SENA_DATA_DIR`                                                                                 | Directory for SQLite persistence; database path is `<dir>/sena.sqlite`. `:memory:` is intended for tests.                                     |
| `SENA_MODULES_DIR`                                                                              | Module root directory, default `./modules`.                                                                                                   |
| `SENA_TRUSTED_MODULE_IDS`                                                                       | Comma-separated exact IDs whose code the owner explicitly trusts. The built-in `basic` module is trusted by the release.                      |
| `LOG_LEVEL`                                                                                     | Pino level. Logs redact configured secrets and secret-like fields.                                                                            |
| `MINECRAFT_HOST`, `MINECRAFT_PORT`, `MINECRAFT_USERNAME`, `MINECRAFT_AUTH`, `MINECRAFT_VERSION` | Mineflayer connector settings. In online mode, host and username are required. `MINECRAFT_VERSION` may be empty for server-version detection. |
| `DISCORD_BOT_TOKEN`                                                                             | Enables the Discord adapter when non-empty.                                                                                                   |
| `DISCORD_OWNER_IDS`, `DISCORD_ADMIN_ROLE_IDS`                                                   | Privileged Discord user IDs and role IDs.                                                                                                     |
| `DISCORD_GUILD_ID`, `DISCORD_COMMAND_CHANNEL_IDS`                                               | Optional guild and channel restrictions for commands.                                                                                         |
| `DISCORD_REGISTER_COMMANDS`                                                                     | Defaults to `false`; set true to register guild slash commands (requires `DISCORD_GUILD_ID`).                                                 |
| `DISCORD_ALERTS_CHANNEL_ID`                                                                     | Destination for persisted runtime alerts.                                                                                                     |
| `AI_LLM_PROVIDER`                                                                               | Defaults to `none`; set `nvidia-nim` to enable the NIM LLM-backed planner. `ollama` is reserved but not implemented.                          |
| `NVIDIA_NIM_LLM_API_KEY`, `NVIDIA_NIM_LLM_MODEL`, `NVIDIA_NIM_LLM_BASE_URL`                     | LLM key, model ID, and optional API base URL (defaults to NVIDIA's integrate endpoint). Key is never included in logs.                        |
| `AI_VLM_PROVIDER`, `NVIDIA_NIM_VLM_API_KEY`, `NVIDIA_NIM_VLM_MODEL`, `NVIDIA_NIM_VLM_BASE_URL`  | Separate VLM settings; validation exists, but VLM inference is not implemented yet.                                                           |

In the current Termux workspace, run Node commands with `LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib` to select the installed C++ runtime. On a normal Node installation, use the npm commands without that prefix.

NIM planning is an advisory boundary only. Returned JSON is validated against the plan schema and registered capabilities; there is no gameplay executor wired to model output. See `AI.md` for current limitations.
