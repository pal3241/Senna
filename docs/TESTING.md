# Testing

`npm run check` runs formatting, TypeScript typecheck, ESLint, Vitest, and the production build. Unit tests cover offline startup/shutdown, configuration and secret handling, task transitions/recovery, module trust and path checks, planner/provider behavior, connector retries and world facts, action serialization/cancellation/verification/timeouts, Discord authorization, and notification delivery.

All deterministic tests use fakes; they do not establish live Minecraft, Discord, or NVIDIA integration. The current repository quality gate is recorded in the latest implementation report in `docs/NEXT_PHASE_AND_REPOSITORY_AUDIT.md`.

## Optional Minecraft movement smoke test

This is an opt-in manual test. Use a disposable or explicitly authorized test server and a dedicated test account. Do not run against a public server without its owner's permission. Configure `SENA_MODE=online`, the test server address, username/auth mode, and the authorized Discord owner/guild/channel settings in a local `.env`; never commit or paste credentials. Command registration is an external Discord write and must be explicitly enabled with `DISCORD_REGISTER_COMMANDS=true` if the slash command has not already been registered.

1. Start the test server and confirm the chosen nearby destination is loaded, safe, and within 48 blocks of the bot's observed position.
2. Start Sena and record server Minecraft version, configured auth mode, and package versions without recording secrets or private server details.
3. In the authorized Discord channel, submit `/sena task` with `move_to <x> <y> <z>` for a nearby safe coordinate.
4. Verify in-game that the bot reaches the target; query `/sena tasks` and confirm the task is `succeeded` only when the fresh position observation is within the documented tolerance. Also verify an unsupported goal or disconnected run is not reported as success.
5. Record the result as `passed`, `failed`, or `not tested`, plus the exact goal, server version, auth mode, and any limitation. Do not include tokens, account identifiers, or private host details.

No live-server smoke test has been run for this phase. Collection has no smoke procedure because its plugin is audited but blocked and is not installed.

In this Termux environment, invoke Node commands with `LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib` so the installed C++ runtime is selected.
