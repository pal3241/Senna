# Next Phase: Gameplay Execution and Resource Collection

Audit date: 2026-10-27  
Repository: `pal3241/Senna`  
Target branch: `main`

## Current status

Sena is a safety-first Minecraft Java agent with an optional Discord control plane. Its currently supported gameplay path is bounded `move_to <x> <y> <z>` execution through the task lifecycle and a single FIFO action coordinator. The implementation includes movement-failure cleanup, cancellation/timeout classification, bounded world observations, task outcome reason codes, restart reconciliation, and trusted-module loading.

The current implementation and regression tests have been run. The latest recorded full quality-gate result in the repository is from 2026-10-26:

```sh
LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib npm run check
```

Recorded result: formatting, TypeScript typecheck, ESLint, 51 tests across 13 files, and production build passed. Do not interpret fake-based tests as a live Minecraft, Discord, or NVIDIA integration test.

## Completed work

- Pathfinder failure and cancellation stop navigation while the shared action lane owns movement; original navigation errors are preserved.
- Timeout and explicit cancellation remain distinguishable in cleanup and task reporting.
- Task failures use stable reason codes and do not become success-shaped results without verified postconditions.
- Invalid player positions do not produce fabricated entity distances.
- Requested block coordinates and observation bounds are validated; stale observations retain their original timestamps.
- Minecraft connection events do not overwrite the independent LLM health state.
- Cleanup claims are persisted only when supported by cleanup evidence.
- Untrusted modules are regression-tested through the module host.
- Compatibility research for resource-collection packages is documented in `docs/COMPATIBILITY.md`.

## Resource collection: current decision

**Bounded resource collection is not enabled in the current repository.** The compatibility audit found that the published `mineflayer-collectblock@1.6.0` implementation can override movement-safety flags, and its cancellation path stops pathfinding without proving that an active dig has stopped. The published `mineflayer-tool@1.2.0` was audited as a dependency candidate. No collection dependency is installed in the current `package.json`.

Do not treat a successful test run of the existing movement slice as proof that collection is safe. Before enabling collection, establish a cancellation contract that interrupts or awaits digging, prevents plugin-owned movement settings from weakening Sena's policy, and verifies task postconditions.

## Next implementation steps

### 1. Establish safe collection cancellation

- Define ownership of the active dig, pathfinder operation, and cancellation signal.
- Ensure cancellation and timeout stop collection and movement without affecting a later queued action.
- Preserve Sena's conservative movement settings; reject any plugin behavior that overrides required safety invariants.
- Record the exact released package versions and source evidence in `docs/COMPATIBILITY.md`.
- Keep collection disabled if the contract cannot be proven.

### 2. Add one bounded `collect_block` capability

Only proceed after step 1 passes review.

- Register the capability through the existing plugin registry and Minecraft adapter.
- Route it through `ActionCoordinator` and the existing task lifecycle; do not add a parallel executor or direct LLM-to-bot control.
- Validate block name, search radius, distance, connection/spawn readiness, inventory/hand requirements, and timeout.
- On cancellation, timeout, disconnect, or plugin failure, stop the operation and release the action lane safely.
- Verify the result with a fresh inventory/world observation. A resolved plugin promise alone is not proof of success.
- Persist checkpoints only after verified progress. Reconcile observations after restart or reconnect before resuming.
- Keep collection unavailable in offline mode and when required providers or plugins are unavailable.

### 3. Verify and report

Run the full project gate:

```sh
npm run check
```

Add or retain tests for:

- cancellation and timeout during collection;
- pathfinder and plugin errors;
- malformed arguments and out-of-range targets;
- unavailable plugins and disconnected Minecraft;
- verified and unverified postconditions;
- stale/unknown world observations;
- persistence and restart recovery;
- action-lane release and no overlapping movement/collection operations;
- offline startup.

Label fake/unit tests separately from any live smoke test. If a disposable Minecraft server is available, record its version, authentication mode, exact task, and result. Otherwise mark live Minecraft testing as `not tested`.

## Out of scope

- combat, PVP/PVE, armor/equipment automation, and projectile prediction;
- VLM or screenshot-based control;
- long-term learning and automatic model updates;
- autonomous base construction or schematic generation;
- untrusted third-party module sandboxing;
- unrelated dashboard or Discord redesign.

## Acceptance criteria

- [ ] Collection cancellation is proven safe for active digging and pathfinding.
- [ ] Collection cannot override Sena's movement-safety policy.
- [ ] `collect_block` runs only through the existing action coordinator and task lifecycle.
- [ ] Completion is recorded only after a fresh, authoritative postcondition check.
- [ ] Cancellation, timeout, disconnect, and plugin failures never become false success.
- [ ] Full quality gate passes with exact command and test counts recorded.
- [ ] Live integration status is reported separately from fake/unit tests.
- [ ] README, this phase document, and `docs/COMPATIBILITY.md` agree on the supported scope.

## Stable task outcome mapping

| Condition | Task status | Reason code |
| --- | --- | --- |
| Verified action postcondition | `succeeded` | No error; verified checkpoint stored |
| Action timeout | `blocked` | `action-timeout` |
| Postcondition not observed | `blocked` | `postcondition-unverified` |
| Preconditions not met | `blocked` | `precondition-failed` |
| Adapter/plugin exception | `blocked` | `action-failed` |
| Minecraft disconnect | `blocked` | `minecraft-disconnected` |
| Explicit owner cancellation | `cancelled` | Cancellation event; no success checkpoint |

## Required completion report

For the next implementation, report:

1. findings fixed and findings left open;
2. files changed;
3. exact package versions and compatibility evidence if a dependency is added;
4. exact test commands and actual pass/fail counts;
5. whether live Minecraft was tested, including server version if applicable;
6. known limitations and the smallest next task.

Do not describe Sena as fully autonomous or production-ready based only on bounded movement or a single collection task.
