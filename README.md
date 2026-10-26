# Sena

Sena is a safety-first autonomous Minecraft Java agent, with Discord as its planned control plane. The repository is being implemented in the phases defined by `SENA_AGENT_SPEC.txt`.

## Current status

The current runtime includes strict configuration, redacted logging, persistent tasks and alerts, restart reconciliation, trusted module loading, a Mineflayer connector with pathfinder, structured world observations, a single-lane action coordinator, an authorized Discord slash-command adapter, and an NVIDIA NIM LLM client with a validated planning boundary. Connector behavior, command authorization, and planner/provider behavior have automated tests; live Minecraft, Discord, and NVIDIA connections have not been tested. Plans are proposals only: gameplay execution, memory/learning, VLM, and gameplay action handlers remain unimplemented. See `docs/COMPATIBILITY.md` for exact versions and remaining integration work.

## Requirements and commands

Use Node.js 24.17 or newer and npm. This matches the current discord.js 14 documentation requirement. Run `npm install`, copy `.env.example` to `.env`, then:

```sh
npm run check
npm run dev
```

The default `SENA_MODE=offline` path does not require game, Discord, or provider credentials. Never commit `.env`.

See `docs/COMPATIBILITY.md` for audited choices and unverified integrations.
Community modules remain untrusted unless their exact IDs are configured in `SENA_TRUSTED_MODULE_IDS`; see `docs/MODULES.md` before enabling module code.
