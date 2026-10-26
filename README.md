# Sena

Sena is a safety-first Minecraft Java agent with an optional Discord control plane. The repository is being implemented in the phases defined by `SENA_AGENT_SPEC.txt`.

## Current status

The current runtime includes strict configuration, redacted logging, persistent tasks and alerts, restart reconciliation, trusted module loading, a Mineflayer connector with pathfinder, bounded freshness-aware world observations, a single-lane action coordinator, and an authorized Discord slash-command adapter. One deterministic gameplay path is implemented end-to-end: an authorized task using `move_to <x> <y> <z>` is persisted, range-checked, navigated with conservative pathfinder settings, and completed only after a fresh position observation verifies arrival. Unsupported goals are blocked; arbitrary LLM-generated goals are not executed. Automated tests use fakes; live Minecraft, Discord, and NVIDIA connections have not been tested. Resource collection was audited but remains disabled because the released collectblock plugin does not meet Sena's cancellation and movement-safety requirements. Combat, memory/learning, and VLM remain unimplemented. See `docs/NEXT_PHASE_AND_REPOSITORY_AUDIT.md` for phase results and `docs/COMPATIBILITY.md` for integration status.

## Requirements and commands

Use Node.js 24.17 or newer and npm. This matches the current discord.js 14 documentation requirement. Run `npm install`, copy `.env.example` to `.env`, then:

```sh
npm run check
npm run dev
```

The default `SENA_MODE=offline` path does not require game, Discord, or provider credentials. Never commit `.env`.

See `docs/COMPATIBILITY.md` for audited choices and unverified integrations.
Community modules remain untrusted unless their exact IDs are configured in `SENA_TRUSTED_MODULE_IDS`; see `docs/MODULES.md` before enabling module code.
