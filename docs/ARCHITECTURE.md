# Architecture and implementation status

Sena is being built as a local TypeScript runtime with Minecraft capabilities behind adapters and Discord as the control plane. This document distinguishes working pieces from planned subsystems.

## Implemented

- `src/app/bootstrap.ts` loads validated configuration, opens persistence, constructs the task repository, and provides graceful shutdown.
- `src/core/event-bus.ts` defines typed runtime events.
- `src/core/tasks/` validates task records, legal state changes, bounded retries, cancellation requests, and progress checkpoints.
- `src/core/modules/` validates module manifests and paths, rejects duplicate IDs/cycles/unavailable dependencies, orders trusted modules, and starts only explicitly trusted code. `modules/basic` is a built-in deterministic health assessment capability.
- `src/adapters/minecraft/` creates a Mineflayer connection, loads pathfinder, reconnects with bounded backoff, normalizes health/death events, and exposes world observations with timestamps and unknown states.
- `src/adapters/discord/` restricts slash commands by configured owner/role/guild/channel, queues goals and controls, and drains a persistent alert outbox when Discord is available. Slash command registration is opt-in.
- `src/execution/action-coordinator.ts` serializes all gameplay control through one FIFO lane, validates preconditions, bounds execution and verification, runs cleanup, and reports unverified outcomes as failures.
- `src/storage/database.ts` owns SQLite setup and schema migration. `data/sena.sqlite` holds tasks and task events; active work is marked `interrupted` when a process starts so callers must reconcile before resuming.
- `src/core/health.ts` exposes an in-memory health snapshot.

All task movement is represented by persisted transitions. Modules receive no raw bot object; the current module host exposes a sanitized mode setting, scoped logger, capability registration, and allowlisted event subscriptions. Other manifest permissions are recognized but keep a module inactive until its service is implemented. Discord goals are persisted but do not execute yet because planner and gameplay handlers are still pending.

## Safety boundaries planned for subsequent phases

LLM/VLM output will be validated proposals only. Untrusted modules will not execute automatically. PVP remains disabled by default. These boundaries are requirements from the master specification, not yet implemented features.

## Data and recovery

SQLite migrations use `PRAGMA user_version`; task and task-event writes use explicit transactions. Restart recovery never replays a `running` action: it changes active task records to `interrupted` and records that reconciliation is required. Checkpoint payloads are capped at 32 KB and logs/task text pass through secret redaction. The database uses WAL mode and full synchronous writes.
