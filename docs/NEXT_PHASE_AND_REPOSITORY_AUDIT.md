# Repository Audit and Next Phase: Safe Resource Collection

Audit date: 2026-10-26  
Repository: `pal3241/Senna`  
Target branch: `main`  
Purpose: replace the previous gameplay-execution phase note with an evidence-based audit and the next implementation plan.

Implementation status: execution hardening implemented and fake-tested; resource collection audited and blocked pending a safer cancellation/movement contract; live Minecraft smoke test not tested.

## 1. Current verified scope

The current repository is a safety-first TypeScript/Mineflayer runtime with a Discord control plane. The README and source currently describe or implement:

- offline runtime mode, configuration validation, structured/redacted logging, task persistence, restart reconciliation, health/events, and module trust checks;
- a Mineflayer connection manager with bounded reconnect attempts and a plugin registry;
- a bounded world snapshot for player facts, inventory, equipment, nearby entities, and explicitly requested blocks;
- a single FIFO action coordinator and a deterministic `move_to <x> <y> <z>` task path;
- movement safety settings that disable digging, parkour, towers, sprinting, scaffolding, and drops greater than one block;
- a Discord slash-command adapter and an NVIDIA NIM planning client with validated output.

The documented quality gate is `npm run check`. The previous phase report recorded 42 tests across 12 files passing; this phase adds regression coverage for the findings below. Live Minecraft navigation, live Discord login/command sync, and live NVIDIA API requests remain unverified. Do not treat fake-based tests as live integration tests.

## 2. Problems and risks found in source/documentation review

These are code-review findings, not claims that a live server reproduced the failures.

### P0 — Pathfinder failure may leave movement active

File: `src/adapters/minecraft/minecraft-adapter.ts`

The `moveTo()` method races the pathfinder's `goto()` promise against cancellation. Its `finally` block calls `pathfinder.stop()` only when the abort signal is set. If `goto()` rejects due to a pathfinding/plugin error while the signal is not aborted, the adapter does not explicitly stop pathfinding. This can leave the underlying movement behavior running after the task has failed.

Required repair:

- stop pathfinder on cancellation and on any unsuccessful navigation exit;
- preserve the original error and do not convert failure to success;
- avoid stopping a later action's pathfinder run accidentally; keep the shared action lane and ownership assumptions explicit;
- add a regression test where `goto()` rejects, then assert cleanup/stop behavior and that the task is not completed;
- test cancellation and successful navigation separately.

### P1 — Entity distance is misleading when player position is invalid

File: `src/adapters/minecraft/world-observer.ts`

When the player's position cannot be normalized, the observer substitutes `{ x: 0, y: 0, z: 0 }` for distance calculations. Entities can then be reported as nearby based on distance from the world origin, even though the player's location is unknown.

Required repair:

- if player position is unknown, do not calculate entity distances from a fabricated origin;
- return entities as unknown/empty-with-explicit-status according to the existing fact contract, rather than implying a reliable nearby list;
- add a test with a missing/non-finite player position and entity positions far from the origin.

### P1 — Action result types do not expose all failure states as structured results

File: `src/execution/action-coordinator.ts`

The public success result type represents only `status: "succeeded"`; failures are propagated through rejected promises and typed error classes. This can work, but every caller must normalize exceptions into persisted task states and operator-visible reason codes. Verify that cancellation, timeout, adapter errors, and postcondition failures all result in a non-success persisted task state and release the action lane/resources.

Required repair:

- audit the task/action boundary and document one stable mapping from coordinator errors to persisted task outcomes/reason codes;
- add or extend tests for each failure mapping and ensure the next queued action can run after cleanup;
- do not replace thrown errors with success-shaped values.

### P1 — The implemented gameplay capability is still narrow

Files: `README.md`, `docs/COMPATIBILITY.md`, `src/adapters/minecraft/plugin-registry.ts`

The only registered gameplay plugin is `mineflayer-pathfinder`. `mineflayer-collectblock`, `mineflayer-tool`, combat, armor, projectile, and auto-auth integrations are not installed and are explicitly deferred. The currently documented goal is bounded movement; block collection and survival progression are not implemented.

Required repair:

- audit candidate collection/tool packages before adding them;
- record package/version, API, license, maintenance, peer compatibility, safety implications, and source links in `docs/COMPATIBILITY.md`;
- install no package until the audit supports the choice;
- expose collection through the existing adapter/coordinator, never through a second executor or direct LLM-to-bot access.

### P1 — Live integration behavior remains unverified

Files: `docs/COMPATIBILITY.md`, `README.md`

Fakes cover deterministic code paths, but live Mineflayer navigation, server-specific behavior, Discord authentication/command sync, and NVIDIA credentials/API calls are not tested. Server version, permissions, anti-cheat, terrain, and login mode can affect real behavior.

Required repair:

- add an opt-in smoke-test procedure with explicit prerequisites and a disposable/test server recommendation;
- label each result `passed`, `failed`, or `not tested`; never infer live success from unit tests;
- keep CI and offline startup independent of credentials and an always-on Minecraft server.

### P2 — World observation contract needs stronger edge-case guarantees

File: `src/adapters/minecraft/world-observer.ts`

The observer bounds nearby entities and requested block positions, and represents unavailable facts as unknown. However, the fabricated player-origin fallback above can undermine that uncertainty contract. Tests should also ensure malformed requested coordinates, unloaded blocks, stale disconnected snapshots, and entity-count bounds cannot be mistaken for authoritative world facts.

Required repair:

- define and test exact semantics for unknown, stale, and known facts;
- reject or mark invalid coordinates instead of querying arbitrary positions;
- preserve original observation timestamps when a fact becomes stale;
- test maximum entity/block bounds and missing chunk data.

### P1 — Runtime mode can misreport AI availability

File: `src/adapters/minecraft/minecraft-adapter.ts`

The Minecraft connection callback sets runtime mode to `OFFLINE_AI` whenever the Minecraft connection spawns, even though LLM availability is tracked independently in `HealthSnapshot.llm`. This can make health reporting claim AI is offline based only on a Minecraft state transition.

Required repair:

- make runtime mode reflect provider and connection health together;
- prevent the Minecraft adapter from overwriting unrelated health dimensions;
- add tests for spawned + LLM available, spawned + LLM unavailable, and disconnected Minecraft.

### P1 — Persisted failure details can claim cleanup without evidence

File: `src/execution/task-execution-service.ts`

The generic error path persists `actionStopped: true` and `resourceReleased: true` for any thrown action error. A failed cleanup callback or adapter-level failure can make these claims inaccurate.

Required repair:

- persist cleanup state only when the coordinator/adapter reports it;
- otherwise use an explicit unknown/failed value and preserve the reason code;
- test cleanup failure and ensure it cannot produce a success-shaped task result.

### P1 — Timeout cleanup is classified as cancellation

File: `src/execution/action-coordinator.ts`

The timeout handler aborts the action controller with an `ActionTimeoutError`, but the catch path chooses cleanup reason `cancelled` whenever the controller is aborted. This loses the distinction between a timeout and an operator/task cancellation.

Required repair:

- preserve the original terminal cause through cleanup and task reporting;
- distinguish timeout from cancellation in logs, reason codes, and tests;
- prove timeout still stops movement and permits the next queued action after cleanup.

### P2 — Module trust is not a process sandbox

File: `docs/MODULES.md`

The documentation correctly says trusted modules execute with Node.js process privileges and there is no process sandbox. Exact-ID trust is a useful gate, not isolation.

Required follow-up:

- keep untrusted modules undiscoverable to execution and test that they are never imported;
- do not grant raw Mineflayer bot access to modules;
- defer third-party module execution in an untrusted process until a real isolation design exists.

## 2.1 Implementation results

- Pathfinder `goto()` rejection and cancellation now stop the pathfinder while the shared action lane still owns movement. The original navigation error is preserved. The coordinator distinguishes timeout cleanup from cancellation and releases the action lane before rejecting to callers.
- The task/action boundary persists stable reason codes: timeout → `action-timeout`, verification failure → `postcondition-unverified`, precondition failure → `precondition-failed`, and other plugin/adapter exceptions → `action-failed`. Explicit owner cancellation becomes `cancelled`; disconnects are `blocked` with `minecraft-disconnected`. Cleanup and movement-release claims are persisted only from coordinator cleanup evidence; the lane-release fact is tracked separately.
- Entity distance is unknown when player position is invalid. Explicit block requests are limited to 32 positions and Minecraft coordinate bounds; invalid or oversized requests are not queried. Bounded entity/inventory facts expose when the list was truncated, and stale facts retain their original observation timestamps.
- Runtime mode now combines Minecraft and LLM health. Minecraft state updates no longer overwrite LLM state; an LLM request updates availability, while SAFE_HALT persists until explicit resume.
- Untrusted module loading is regression-tested through `ModuleHost`, not only by checking discovery status.
- Collection remains disabled after compatibility review. No collection dependencies were installed; details and evidence are recorded in `docs/COMPATIBILITY.md`.

## 3. Next implementation phase

### Phase title: Execution Hardening and Bounded Resource Collection

The hardening work below is implemented. Collection remains blocked by Step C's safety audit, so Step D is intentionally not implemented. Do not begin combat, VLM, learning, generative building, or broad autonomous goal selection before collection has a safe cancellation and movement-policy contract.

#### Step A — Fix and test movement failure cleanup

1. Repair `MinecraftAdapter.moveTo()` so pathfinder activity is stopped on cancellation and navigation failure, with cleanup ownership safe under the existing single action lane.
2. Add an explicit test where pathfinder `goto()` rejects.
3. Verify the action coordinator receives the original failure and the task cannot become completed.
4. Verify cleanup runs and a subsequent queued action is not permanently blocked.
5. Add a cancellation test that proves pathfinder stop is called exactly as intended.

Acceptance: failure and cancellation stop navigation; the original failure remains observable; no false success or resource leak.

#### Step B — Correct observation uncertainty

1. Remove the player-position fallback to world origin for entity distance.
2. Define the output when the player's position is unknown.
3. Validate block coordinate inputs against finite integer/world bounds before querying Mineflayer.
4. Add tests for missing/non-finite player position, unloaded blocks, stale disconnected snapshots, and entity/block limits.

Acceptance: no fabricated distance or position is emitted as known; unavailable data remains unknown/stale according to the documented contract.

#### Step C — Audit collection/tool compatibility before coding

1. Review the official/current repositories and package metadata for `mineflayer-collectblock` and any required tool-selection dependency.
2. Verify API signatures against the exact resolved versions, peer dependencies, Node compatibility, license, maintenance state, and interaction with the existing pathfinder.
3. Update `docs/COMPATIBILITY.md` with dated evidence and an explicit decision.
4. If compatibility or safety cannot be established, do not install the package; document the blocker and keep collection disabled.

Acceptance: the package decision is evidence-based and reproducible; no invented API or unsupported capability claim.

#### Step D — Implement one bounded `collect_block` action, only if Step C passes

1. Extend the existing plugin registry and Minecraft adapter with the audited collection API.
2. Route collection through the existing `ActionCoordinator` and task lifecycle.
3. Validate block name, search radius, distance, connection/spawn readiness, inventory/hand requirements, and timeout before acting.
4. Make cancellation stop collection/pathfinding and release the action lane.
5. Verify collection by a fresh inventory/world observation or another authoritative postcondition; a resolved plugin promise alone is insufficient.
6. Persist checkpoints only after verified progress. On restart/reconnect, observe and reconcile before any continuation.
7. Keep collection unavailable in offline mode and never fabricate a plan when the provider is unavailable.

Acceptance: one bounded collection task works end-to-end in deterministic fake tests; every failure results in failed/cancelled/blocked, never success without evidence.

#### Step E — Test, report, and smoke-test separately

Run:

```sh
npm run check
```

Add focused tests for:

- pathfinder rejection and cleanup;
- cancellation and timeout during movement/collection;
- malformed arguments and out-of-range targets;
- plugin unavailable or plugin API failure;
- postcondition verification success/failure;
- unknown/stale world observations;
- persisted task outcome after failure/restart;
- offline startup regression;
- no concurrent movement/collection action overlap.

If a Minecraft test server is available, run a separately labelled manual/integration smoke test. Record server version, auth mode, exact task, outcome, and limitations. Otherwise mark it `not tested`. Do not weaken existing tests or lint/type rules to get a green check.

## 4. Out of scope for this phase

- combat/PVP/PVE, armor/equipment automation, projectile prediction, auto-auth;
- NVIDIA VLM, screenshot interpretation, and visual grounding;
- long-term learning or automatic model updates;
- autonomous base construction/schematic generation;
- untrusted third-party module sandboxing;
- a separate web dashboard or unrelated Discord redesign.

## 5. Definition of done

- [x] Pathfinder rejection always triggers safe cleanup and has a regression test.
- [x] Invalid player position never produces fabricated entity distances.
- [x] Requested block coordinates and movement action arguments are validated.
- [x] Collection/tool integration was audited and is explicitly blocked with evidence; no dependency was installed.
- [ ] `collect_block` is not implemented because the released plugin does not meet current movement-safety/cancellation requirements.
- [x] Cancellation, timeout, disconnect, plugin errors, and restart recovery do not produce false completion in the tested task path.
- [ ] `npm run check` result pending final run for this revision.
- [x] Live integration results are distinguished from fake/unit tests; live Minecraft smoke test is `not tested`.
- [x] README, compatibility audit, testing guide, and this phase report describe the same supported scope.
- [x] No credentials, private server details, or secrets were added.

### Stable task failure mapping

| Coordinator/adapter condition | Persisted task status | Reason code                               |
| ----------------------------- | --------------------- | ----------------------------------------- |
| Verified movement             | `succeeded`           | No error; verified checkpoint stored      |
| Pathfinding timeout           | `blocked`             | `action-timeout`                          |
| Postcondition not observed    | `blocked`             | `postcondition-unverified`                |
| Action precondition not met   | `blocked`             | `precondition-failed`                     |
| Adapter/plugin exception      | `blocked`             | `action-failed`                           |
| Minecraft disconnect          | `blocked`             | `minecraft-disconnected`                  |
| Explicit owner cancellation   | `cancelled`           | Cancellation event; no success checkpoint |

### Completion report

Implemented the P0/P1/P2 correctness repairs described above and added focused tests. The package audit found a version mismatch between npm-published releases and repository heads: npm publishes collectblock 1.6.0 and tool 1.2.0, while current repository metadata advertises unreleased 1.7.0 and 1.3.0. Both are MIT; their declared Mineflayer/Pathfinder ranges include the locked versions, but neither declares a Node engine. Collectblock's released source overrides two movement safety flags and its cancel operation stops pathfinding without proving an active `bot.dig()` has ceased; it is therefore not installed or exposed.

The implementation is tested with fakes only. No live Minecraft server, Discord account, or NVIDIA credentials were used. The next smallest task is to define or upstream a collection cancellation contract that interrupts/awaits digging and preserves caller-supplied safe movement settings; only then should the exact released plugin be integrated and a disposable-server smoke test run.

## 6. Required completion report from the coding agent

Report:

1. findings fixed and any findings left open;
2. files changed;
3. package compatibility evidence and links, if a dependency was added;
4. exact test commands and actual pass/fail counts;
5. whether live Minecraft was tested and the server/version used, if applicable;
6. known limitations and the smallest next task.

Do not call Sena fully autonomous or production-ready based on movement or a single collection task.
