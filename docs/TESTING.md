# Testing

`npm run check` runs formatting, TypeScript typecheck, ESLint, Vitest, and the production build. Unit tests cover offline startup/shutdown, configuration and secret handling, valid/invalid task transitions, retry limits, checkpoint persistence, restart recovery, module trust/path checks, dependency resolution, API compatibility, connector retries/world facts, action serialization/cancellation/verification/timeouts, Discord authorization, and alert outbox behavior.

Runtime, persistence, module, adapter, action, and Discord authorization verification passed on Node.js 26.12.1 and npm 11.21.1: 30 tests pass, the production build succeeds, and `npm audit` reports no vulnerabilities. Mineflayer connection behavior uses fakes; live Minecraft, Discord, and NIM integration testing remains pending credentials and an authorized server. In this Termux environment, invoke Node commands with `LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib` so the installed C++ runtime is selected.
