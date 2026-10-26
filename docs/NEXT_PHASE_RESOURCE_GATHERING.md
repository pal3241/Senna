# Next Phase: Reliability Hardening and Verified Resource Collection

Status: planned; implementation has not started  
Repository: `pal3241/Senna`  
Target branch: `main`  
Prepared: 2026-10-26

## 1. Purpose

Extend the existing verified `move_to <x> <y> <z>` path into the next smallest useful gameplay loop: collect a bounded amount of a specified block and verify the inventory change. Do not claim general autonomy or implement combat/building/VLM in this phase.

The work must begin with a baseline test run and a focused reliability pass. The code already has a real Mineflayer adapter, bounded movement, a world observer, a single FIFO action coordinator, persistent tasks, and restart reconciliation. Extend those systems instead of introducing parallel executors or duplicate task state.

## 2. Repository findings and concrete risks

These findings come from reading the current `main` source and documentation. They are code-review findings, not claims that a new test suite has run.

### P0 — Establish the real baseline first

- The previous phase document described the movement slice as implemented and fake-tested, with live Minecraft, Discord, and NVIDIA integrations still untested.
- `AGENTS.md` requires automated tests before declaring work complete. Run `npm run check` before changes and save the actual output. Do not assume a previous green run still describes the current checkout.
- The current default branch documentation says the next phase is still pending. Keep the implementation report honest about fake-based versus live verification.

### P1 — Fix known reliability/observability gaps before adding a new action

1. **Runtime mode is coupled to Minecraft connection state.** In `src/adapters/minecraft/minecraft-adapter.ts`, the connection callback sets mode to `OFFLINE_AI` whenever Minecraft is spawned, even though AI availability is tracked separately in `HealthSnapshot.llm`. A spawned bot can therefore be reported as offline AI while an LLM is available. Make mode calculation reflect actual provider and connection health; do not let the Minecraft adapter overwrite unrelated health dimensions.
2. **Entity distances can be fabricated when player position is unknown.** In `src/adapters/minecraft/world-observer.ts`, a missing/invalid player position falls back to `{x: 0, y: 0, z: 0}` before entity distances are calculated. This can publish plausible but false distances. If the player position is unknown, entity distance must be unknown/omitted or the entity observation must be marked unknown; never calculate from the world origin.
3. **Failure metadata can overstate cleanup.** In `src/execution/task-execution-service.ts`, the catch path records `actionStopped: true` and `resourceReleased: true` for any thrown action error. Those facts are not proven if cancellation or adapter cleanup itself failed. Derive these fields from actual coordinator/cleanup outcomes, or use explicit `unknown`/false states and a reason code.
4. **Timeout and cancellation are conflated in cleanup classification.** In `src/execution/action-coordinator.ts`, the timeout handler aborts the action controller with an `ActionTimeoutError`, while the catch path classifies any aborted controller as `cancelled`. Preserve a distinct timeout reason/status for logs, cleanup, task state, and tests. Ensure timeout cleanup still stops pathfinder behavior.
5. **Pathfinder exception cleanup needs an explicit regression test.** The previous phase report explicitly listed a throwing-pathfinder adapter test as the remaining focused gap. Add a test where `goto()` rejects/throws and prove movement is stopped, the action is not reported successful, and a later action is not stuck behind the failed action.

If a code inspection shows any finding has already been fixed on the working branch, verify it with a test and update this list rather than reintroducing the bug.

## 3. Phase scope and implementation order

### Step A — Baseline and audit

1. Read `AGENTS.md`, `SENA_AGENT_SPEC.txt`, `README.md`, `docs/COMPATIBILITY.md`, `docs/MODULES.md`, the current execution/adapter/task code, and the relevant tests.
2. Run `npm run check` before edits; report the actual result.
3. Map the existing task state transitions and action cleanup behavior. Do not create another action coordinator, bypass task persistence, or expose raw Mineflayer bot access to the planner/modules.

### Step B — Reliability fixes

Implement and test the five findings above. Preserve conservative failure behavior: uncertain state is unknown, cleanup failure must not become success, and unsupported actions remain blocked.

### Step C — Audit the collection plugin before installing it

Investigate the currently maintained `mineflayer-collectblock` package/repository and any required companion package. Record in `docs/COMPATIBILITY.md`:

- exact package version and license;
- repository activity/maintenance evidence and API documentation;
- Node.js, Mineflayer, and Minecraft compatibility / peer constraints;
- required plugin setup and the exact collection API;
- failure, cancellation, and cleanup semantics;
- why it is preferable to the alternatives.

Do not guess method names or install it merely because it is commonly used. If compatibility or cancellation behavior cannot be established, leave collection blocked and finish the reliability fixes with an explicit blocker.

### Step D — Implement one bounded `collect_block` vertical slice

Only proceed if Step C passes. Route the action through the existing `ActionCoordinator` and `GameplayActions` boundary.

Required behavior:

- Accept a validated block identifier and a small, explicit maximum count/search radius. Reject empty/unknown identifiers, invalid limits, excessive radius, and malformed goals before touching Mineflayer.
- Require a spawned connection, fresh known position, known block observations where needed, and the collection plugin to be ready.
- Do not dig or collect from an unbounded radius; do not silently switch to another block type.
- Use a timeout and cancellation signal. On timeout, cancellation, disconnect, or plugin error, stop active pathfinding/digging where the plugin API supports it.
- Verify completion from a fresh inventory observation (expected item-count delta) and/or authoritative plugin result. A resolved plugin promise alone is not proof of success.
- If the target is absent, unloaded, unreachable, protected, or the resulting inventory delta cannot be verified, return a structured blocked/failed outcome. Never mark the task successful based only on intent.
- Persist the task before execution and checkpoint only verified progress. On restart/reconnect, re-observe before retrying; never blindly replay an interrupted collection action.
- Keep the existing deterministic `move_to` goal working and preserve offline startup without Minecraft, Discord, or provider credentials.

Suggested goal contract: `collect_block <block_id> <count>`. Treat this as a proposal to validate against the existing task schema and command interface; do not break established command formats without updating docs and tests.

### Step E — Tests and regression coverage

Add tests for:

- the five reliability findings in Step B;
- invalid block IDs, counts, and search bounds;
- plugin missing/not-ready, target missing, unloaded/unknown blocks, and unreachable target;
- successful collection only after a verified inventory delta;
- plugin rejection/throw, timeout, cancellation, and disconnect cleanup;
- no false success when cleanup fails or outcome remains unknown;
- task persistence/checkpoint and restart reconciliation;
- existing `move_to` success, invalid-goal blocking, provider-unavailable behavior, and offline startup/shutdown.

Use fakes for deterministic tests and label them as fake-based. If a local Minecraft server is available, add a separately labelled smoke test; otherwise report live collection as `not tested`.

### Step F — Quality gate and report

Run:

```sh
npm run check
```

Run any new focused tests as well. Fix failures; do not delete or weaken existing tests, relax lint/type rules, or report a command as passing unless it was actually executed.

Update `README.md` and `docs/COMPATIBILITY.md` to distinguish implemented, tested-with-fakes, blocked, and not-tested-live behavior.

## 4. Explicitly out of scope

Do not add combat/PVP, armor/equipment automation, projectile handling, VLM/screenshots, generative building, long-term learning/model updates, arbitrary autonomous goal generation, or a dashboard redesign in this phase.

The LLM planner exists, but the current task execution path uses a deterministic `move_to` plan and does not yet route arbitrary LLM proposals into executable gameplay. Do not wire free-form LLM output directly to Mineflayer. Any later planner integration must validate capability allowlists, arguments, risk/approval policy, preconditions, and postconditions before the action coordinator can execute it.

## 5. Definition of done

- [ ] Baseline `npm run check` result recorded before changes.
- [ ] Runtime mode reflects actual provider/connection health.
- [ ] Unknown player position never produces fabricated entity distances.
- [ ] Task failure metadata does not claim cleanup/resource release without evidence.
- [ ] Timeout remains distinguishable from user cancellation.
- [ ] Throwing-pathfinder regression test proves cleanup and no false success.
- [ ] Collection plugin audit is documented with sources and version evidence.
- [ ] If compatible, bounded collection is integrated through the existing coordinator and verified from fresh state.
- [ ] If not compatible, collection remains disabled and the blocker is documented; do not fake support.
- [ ] Existing movement, offline mode, persistence, and recovery tests still pass.
- [ ] `npm run check` passes after changes, or exact failures/blockers are reported.
- [ ] Live Minecraft/Discord/provider checks are reported only if actually performed.

## 6. Required completion report

1. Summary of changes and the end-to-end behavior actually implemented.
2. Files changed.
3. Commands run and exact test results.
4. Plugin compatibility evidence and decision.
5. Which claims are fake-tested versus live-tested.
6. Remaining issues and the next smallest task.

Do not describe Sena as fully autonomous or production-ready based on this phase alone.
