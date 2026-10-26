# Next Implementation Phase: Verified Gameplay Execution

Status: implemented; fake-tested; live-server verification pending

Target: next coding-agent task
Repository: `pal3241/Senna`  
Source of truth: `SENA_AGENT_SPEC.txt`, current source code, and `docs/COMPATIBILITY.md`

## 1. Objective

Turn the existing foundation into one narrow, real gameplay path that can observe Minecraft state, accept a validated goal, execute a bounded action through the existing coordinator, verify the outcome, and recover safely from failure.

This phase is complete only when the path is implemented and covered by automated tests. Documentation, mock-only success claims, placeholder handlers, or a planner that merely returns text do not satisfy acceptance.

## 2. Start by auditing the current repository

Before editing:

1. Read `AGENTS.md`, `SENA_AGENT_SPEC.txt`, `README.md`, `docs/COMPATIBILITY.md`, `docs/MODULES.md`, and the relevant source/tests.
2. Inspect the current implementations of:
   - `src/execution/action-coordinator.ts`
   - `src/adapters/minecraft/minecraft-adapter.ts`
   - `src/adapters/minecraft/connection-manager.ts`
   - `src/adapters/minecraft/world-observer.ts`
   - `src/adapters/minecraft/plugin-registry.ts`
   - task persistence/recovery, planner/provider validation, runtime controls, and Discord command routing.
3. Map existing interfaces and tests before designing new ones. Extend working code; do not replace or duplicate it merely to match a proposed file tree.
4. Record gaps against this document in the final report. Do not claim to have run commands unless they were actually run.

## 3. Scope and implementation order

### Step A — World observation contract

Complete or refine the existing observer so consumers receive a typed snapshot rather than reaching into Mineflayer directly.

At minimum, where the bot and world make the information available, represent:

- connection/spawn readiness and observation timestamp;
- player position, dimension/world identifier when available, health, food, oxygen when available, and game mode when available;
- inventory item names/counts and equipped items;
- nearby entities with type/name, position, distance, and relevant health/hostility data only when exposed by the API;
- selected nearby block observations for explicit coordinates or a bounded radius;
- current task/action ownership and runtime safety state, if available through core services.

For every observation that can become stale, include timestamp/freshness or an equivalent explicit status. Distinguish `known`, `stale`, and `unknown`; do not turn missing/unloaded chunks or absent API values into a false claim that an object does not exist. Keep snapshots bounded in size and avoid passing the entire world/chat history to an LLM.

Acceptance:

- Unit tests cover disconnected/unspawned state, missing values, fresh observations, stale observations, and inventory/entity/block normalization.
- Observer tests use fakes/fixtures and never pretend to be a live-server test.
- The observer does not mutate the world or issue gameplay actions.

### Step B — Action contract and single-lane execution

Audit the existing action coordinator and define a small typed action contract. Reuse its locking/queueing behavior where correct. Do not create a second executor that can race with it.

Each action must declare, as appropriate:

- unique action ID and owning task ID;
- capability/action type and validated arguments;
- preconditions and expected postcondition;
- timeout/deadline and cancellation signal;
- required exclusive resource(s), such as movement, digging, hand/inventory, combat, or block placement;
- result status: success, failed, cancelled, timed out, or blocked;
- structured failure reason and evidence used to verify completion.

Requirements:

- Conflicting actions cannot own the same exclusive resource simultaneously.
- A cancelled, timed-out, failed, or completed action releases locks and stops the plugin behavior it started where the API supports it.
- Errors propagate as structured failures; never catch and silently convert errors into success.
- Cleanup runs even when an action throws.
- No infinite retry loops. Retry policy must be bounded and must re-observe state before retrying.
- LLM output is untrusted input: validate schema, action allowlist, arguments, resource bounds, and preconditions before execution.

Acceptance:

- Tests prove two conflicting actions cannot overlap.
- Tests cover cancellation, timeout, thrown plugin errors, lock release, cleanup, and bounded retry.
- Tests prove invalid/unknown action types are rejected.

### Step C — Minimal real gameplay action handlers

Implement only the minimum safe actions needed for one end-to-end vertical slice. Prefer existing Mineflayer APIs and audited plugins over custom pathfinding/mining algorithms.

Recommended initial action set:

1. `observe_status`: read current structured state; no mutation.
2. `move_to`: navigate to a validated finite position using the loaded pathfinder when available.
3. `collect_block`: collect a specified block type within an explicit bounded search radius using the audited collectblock plugin only after compatibility verification.
4. `wait_for_state` or equivalent bounded event/state wait to verify action completion.

If collectblock has not yet been audited/installed, do not invent its API or claim collection is supported. In that case, implement and fully test the status + movement vertical slice first, and document collection as blocked pending plugin audit. Keep action handlers behind the coordinator and a narrow Minecraft adapter interface. No handler or module should receive unrestricted raw bot access unless the existing architecture explicitly requires it and its risk is documented.

For every handler:

- validate arguments and bounds before touching the bot;
- check connection, spawn, required world state, and safety preconditions;
- use an explicit timeout and cancellation path;
- return structured evidence;
- verify the result against a new observation or authoritative Mineflayer event/state;
- report `blocked` or `unknown` when it cannot verify success.

Do not implement combat, building, auto-auth, projectile handling, or VLM in this phase. They depend on the execution contract and are separate later tasks.

### Step D — Task-to-action vertical slice

Connect existing task persistence, validated planning output, action coordinator, Minecraft adapter, and verification into one narrow task lifecycle:

`goal accepted → task persisted → state observed → plan validated → action executed → outcome verified → checkpoint persisted → task completed or safely blocked`

Choose one testable goal, such as navigating to a nearby safe coordinate, for the first complete slice. Add block collection only if its plugin/API passes the compatibility audit and the slice remains bounded.

Requirements:

- Persist task state before execution and checkpoint only verified progress.
- After restart/reconnect, re-observe and reconcile before continuing; never blindly replay a movement/mining action.
- If Minecraft disconnects, stop active world actions and mark the task recoverable/blocked; do not report completion.
- If LLM is unavailable, do not fabricate a new plan. Permit only deterministic, previously validated recovery behavior.
- Ensure Discord remains an adapter: Discord commands submit/cancel/query tasks through core services and do not call Mineflayer/plugin APIs directly.
- Keep the existing offline mode working without Minecraft, Discord, or AI credentials.

### Step E — Observability and failure reporting

Use the existing structured logger and task/alert systems. Include task/action correlation IDs and concise reason codes. Redact credentials and private data.

A failure report should tell the operator:

- what task/action was attempted;
- which precondition or verification failed;
- whether the action was stopped and resources released;
- whether retry/recovery is scheduled, and its bounded limit;
- whether the task is resumable or requires intervention.

Do not flood Discord with every low-level event. Aggregate repeated errors and use the notification outbox where appropriate.

## 4. Required tests

Add automated tests alongside implementation. At minimum:

- observer state normalization and unknown/stale data;
- invalid action arguments and untrusted planner output;
- exclusive-resource conflict and sequential execution;
- cancellation and timeout cleanup;
- plugin/adapter exception propagation;
- postcondition verification success and failure;
- task checkpoint persistence and restart reconciliation;
- Minecraft disconnect during an active task;
- AI/provider unavailable path without false completion;
- offline startup regression;
- Discord adapter routes task requests through core services, if touched.

Use fakes for deterministic unit tests. If a local Minecraft server is available, add a separately labelled integration/smoke test; otherwise mark live-server testing as `not tested`, not passed.

## 5. Commands and quality gate

Run the repository's existing checks after changes:

```sh
npm run check
```

Also run any focused test command introduced for the new action/observer code. Fix failures before reporting completion. Do not weaken tests, remove existing tests, or change lint/type rules just to obtain a green check.

If the environment cannot install dependencies or run a check, report the exact command and blocker. Never report a test as passing based on inspection alone.

## 6. Out of scope for this phase

Do not start these until the vertical slice is verified:

- additional combat, armor, Hawkeye, projectile, auto-auth, and death-event integrations;
- VLM and screenshot interpretation;
- long-term learning/model updates;
- generative building and schematic import;
- broad autonomous goal selection;
- unrelated Discord dashboard redesign or a separate web dashboard.

Do not add packages until the compatibility audit explains the package, version, API, license, maintenance status, and reason it is needed. Update `docs/COMPATIBILITY.md` for every integration decision.

## 7. Definition of done

This phase is complete only when all applicable items are true:

- [x] Existing architecture and relevant code were audited before changes.
- [x] World observations have typed, bounded, freshness-aware state.
- [x] The implemented gameplay action uses the existing single-lane coordinator.
- [x] Bounded movement is implemented against the real Mineflayer adapter, not only a mock.
- [x] Task lifecycle connects persistence, action execution, verification, checkpointing, and restart reconciliation. Interrupted tasks are not automatically resumed.
- [x] Cancellation, disconnection, and postcondition failures stop safely and never produce false success. Timeout and adapter-error cleanup are covered by coordinator/action tests.
- [ ] All tests listed in Section 4 are covered. Remaining focused gap: an explicit throwing-pathfinder adapter test; existing suites cover coordinator timeout/cleanup, offline startup/shutdown, planner/provider-unavailable behavior, and task restart recovery.
- [x] `npm run check` passes (format, typecheck, lint, 42 tests across 12 files, build).
- [x] README/docs distinguish implemented, fake-tested, blocked, and not-tested behavior.
- [x] No secrets, server credentials, or private runtime data were added.

### Implementation report

The vertical slice supports only deterministic `move_to <x> <y> <z>` goals. It requires a spawned connection, a known position, an available pathfinder, integer world-bounded coordinates, and a target within 48 blocks. Navigation uses the shared `ActionCoordinator`; safe movement settings disable digging, parkour, tower building, sprinting, scaffolding, and drops over one block. A task is marked successful only after a new world snapshot places the player within 1.75 blocks of the target. Unsupported goals, disconnections, cancellation, and unverified movement do not produce success. Active work is stopped on shutdown and awaited before the database closes; after restart, active tasks remain interrupted for explicit reconciliation.

The observer provides bounded, freshness-aware player, inventory, equipment, entity, and explicitly requested block observations. Unloaded blocks and unavailable values remain unknown. Collection remains blocked pending a separate plugin compatibility audit. Tests use deterministic fakes; no live Minecraft server was available, so live navigation is not tested. The implementation does not execute free-form LLM plans.

## 8. Required agent completion report

At the end, report:

1. Summary of behavior implemented and why it is genuinely connected end-to-end.
2. Files created/changed.
3. Tests and commands actually executed, with their actual results.
4. Any compatibility decisions and links/evidence added to `docs/COMPATIBILITY.md`.
5. What is verified with fakes versus a live Minecraft server.
6. Remaining blockers and the next smallest implementation task.

Do not describe Sena as fully autonomous or production-ready based on this phase alone.
