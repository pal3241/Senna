# Andy-4.2 Micro Gameplay Brain Integration

Status: design specification; implementation and live gameplay validation are not yet complete.  
Repository: `pal3241/Senna`  
Target branch: `main`  
Model: [Mindcraft-CE/Andy-4.2-Micro](https://huggingface.co/Mindcraft-CE/Andy-4.2-Micro)  
GGUF distribution: [Mindcraft-CE/Andy-4.2-Micro-GGUF](https://huggingface.co/Mindcraft-CE/Andy-4.2-Micro-GGUF)

## 1. Goal

Integrate Andy-4.2 Micro as Sena's local gameplay reasoning model. It is responsible for choosing and revising gameplay goals and tactics from bounded game-state observations. It is not the chat interface, the emergency reflex controller, or the action executor.

This document defines the intended integration contract. It does not claim that Andy is already connected to Sena.

## 2. Model facts and caveats

The upstream model card describes Andy-4.2 Micro as an 800M-parameter Minecraft-specialized model based on Qwen3.5, with vision capability and GGUF variants. The upstream card recommends LM Studio and reports problems in its Ollama tests involving looping and chat-template mismatches. It also explicitly says Micro was not tested for autonomous completion of a full diamond-armor set.

Treat those as upstream claims, not results reproduced by Sena. Pin the exact model repository revision, quantization, runtime version, chat template, and sampling configuration in local configuration and test reports. Do not assume that a generic chat-completions prompt or another Andy version's template is compatible.

Initial runtime candidate: a compatible GGUF runtime with a local HTTP API. Validate the selected runtime and template against the exact model before implementing the provider adapter. LM Studio is the upstream recommendation; other runtimes are candidates only after compatibility tests. Keep the runtime replaceable behind a provider interface.

## 3. Responsibility boundaries

### Andy gameplay brain

- Receives a compact, fresh, structured observation of the current game state.
- Chooses a supported goal or tactical intent, such as continue objective, seek resources, prepare for combat, engage, retreat, recover, or reassess.
- Revises a plan when new observations invalidate its assumptions.
- Uses only the structured gameplay output contract described below.
- Never sends player chat, Discord messages, arbitrary shell commands, raw JavaScript, or direct Mineflayer calls.

The model may internally use language tokens to reason. “No chat capability” means Sena does not expose Andy as a conversational interface and does not route its output to chat; it does not imply language representations can be cleanly removed from model weights.

### Deterministic safety and reflex layer

- Uses Mineflayer's entity tracking/events and current entity state as the primary source for visible/known mobs.
- Detects nearby threats without waiting for an LLM request.
- Applies immediate, bounded emergency behavior when a configured threat condition is met.
- Owns safety invariants, action cancellation, timeouts, and arbitration for movement/combat control.
- Does not assume entity tracking sees entities outside client tracking range or guarantees detection before damage.

### Action executor

- Is the only component permitted to issue gameplay actions.
- Validates all model proposals against registered capabilities, task lifecycle, current preconditions, range bounds, and the existing single action coordinator.
- Rejects unsupported or malformed actions.
- Verifies postconditions from fresh observations before reporting success.
- Does not treat a model response, tool-call text, or resolved promise alone as proof that an action succeeded.

### Vision

VLM and screenshot-based danger detection are explicitly out of scope for this phase. Use Mineflayer's built-in entity/mob information for the first danger-reflex implementation. Revisit vision only in a separate design after the entity-based path has been evaluated.

## 4. Intended architecture

```text
Mineflayer world/player/entity observations
                 |
                 +------------------------------+
                 |                              |
        Threat/reflex monitor             State snapshot builder
                 |                              |
        Immediate safe response           Gameplay brain provider
                 |                              |
                 |                       Andy local / cloud provider
                 |                              |
                 +----------> Action coordinator <----------+
                                      |
                                Action executor
                                      |
                               verified game result
                                      |
                              refreshed state/memory
```

The reflex monitor must remain responsive while Andy is generating. A tactical answer can influence the next safe decision, but it must not delay or override an urgent reflex. There must be a single owner of movement and combat actions to prevent concurrent commands from Andy, the reflex controller, and other tasks from fighting each other.

## 5. Python inference service and Sena adapter

Keep Python inference separate from the existing Node.js/Mineflayer runtime:

- Python service owns model loading, inference, prompt/template construction, output parsing, and model health.
- Sena's Node.js provider adapter sends a bounded state snapshot over loopback HTTP and validates the response again on the Sena side.
- Use explicit request IDs, deadlines, cancellation where supported, and a schema version.
- Bind the service to loopback by default; do not expose an unauthenticated model-control API to the LAN.
- The service must report readiness only after model loading and a smoke inference succeed.
- If the local service is unavailable, Sena may use its configured cloud gameplay provider when available. If no provider is available, deterministic behavior and the reflex layer continue; unsupported tasks must not be fabricated as successful.

Suggested logical endpoints (names are design suggestions, not existing endpoints):

- `GET /health`: readiness, loaded model ID/revision, runtime, and schema version.
- `POST /decide`: accept one observation and return one structured gameplay proposal.
- Optional `POST /feedback`: record a verified outcome for diagnostics or later offline dataset curation. It must not silently train or mutate model weights at runtime.

Do not start with live online training or automatic weight updates.

## 6. State snapshot contract

Send only the information needed for the current decision. Include:

- schema version, request ID, observation timestamp, game/server version when known;
- player position, health, food, active effects, equipment, armor, weapon, durability, and inventory summary;
- current task/goal, progress checkpoint, and recent verified action outcomes;
- nearby tracked entities with type, position/distance, health when available, and age/freshness of observation;
- known environmental hazards and candidate escape/approach constraints when available;
- death-recovery cost indicators, such as valuable carried items, distance from recovery point, and current objective value;
- active reflex state and action-coordinator state, so the model does not propose an incompatible action.

Unknown or stale fields must be represented explicitly as unknown/stale rather than guessed. Bound entity count, inventory detail, history length, and total prompt size. Do not send the entire world or unbounded chat history.

## 7. Gameplay decision output contract

The model output is a proposal, not an executable command. Parse it into a strict schema similar to:

```json
{
  "schema_version": 1,
  "goal": "survive_and_continue",
  "intent": "retreat",
  "target": null,
  "priority": 0.9,
  "risk_assessment": {
    "estimated_death_risk": "high",
    "loss_cost": "high"
  },
  "reason_codes": [
    "multiple_hostile_entities",
    "low_health",
    "valuable_inventory"
  ],
  "reconsider_when": [
    "threat_count_decreases",
    "health_recovers",
    "safe_position_reached"
  ]
}
```

This is an illustrative schema, not a promise that Andy emits this JSON natively. The adapter must follow the exact supported model template, parse tool calls or generated text conservatively, and reject malformed output. Do not depend on free-form chain-of-thought text; store concise reason codes and the proposed intent instead.

Initial intents should be limited to those Sena can safely support. Example intents include `continue_goal`, `observe`, `seek_safety`, `retreat`, `engage`, `recover`, and `reassess`. A proposal such as `engage` does not authorize an attack by itself; the executor and combat capability must validate the actual action.

## 8. Combat decisions while moving

Combat planning is asynchronous and repeatedly reconsidered from fresh observations. It should weigh:

- enemy types, count, distance, approach direction, and available escape routes;
- current health, food, armor, weapon strength, durability, and effects;
- terrain hazards, fall/lava risk, and whether a safe route is reachable;
- value of carried items, cost of death/recovery, and importance of the current objective;
- whether the fight is necessary, avoidable, or likely to become a multi-enemy encounter.

The model does not calculate emergency reaction timing. Deterministic reflex rules handle urgent danger immediately. The planner can recommend continuing to retreat, changing route, recovering, or fighting only when conditions permit. Re-evaluate when important state changes occur; avoid requesting a new inference on every game tick.

## 9. Timeouts, failures, and fallback

- Apply a short, configurable inference deadline; record latency and timeout reason.
- Ignore late responses for expired request IDs.
- Never let a model timeout block the reflex monitor or action coordinator.
- On invalid output, stale state, runtime failure, or repeated model loops, reject the proposal and use deterministic fallback behavior.
- Use bounded retries only; do not retry the same invalid output indefinitely.
- Circuit-break a repeatedly failing provider and mark its health separately from Minecraft connection health.
- When switching between local and cloud providers, preserve the current task/state but require a fresh observation before accepting a new proposal.
- On provider recovery, switch at a safe decision boundary rather than interrupting an active emergency response.

## 10. Test plan and acceptance criteria

### Unit/contract tests

- Valid proposal parsing and schema-version handling.
- Malformed JSON, unexpected tool calls, unknown intent, and oversized output are rejected.
- Stale/unknown observations are represented correctly and cannot be silently treated as safe.
- Provider timeout, disconnect, model loop, and late response do not block or overwrite reflex behavior.
- Reflex response occurs without awaiting model inference.
- Reflex, planner, and task execution cannot issue conflicting movement commands.
- High death-loss cost and low health influence tactical context, while the executor still validates actual actions.
- Action completion requires a fresh, authoritative postcondition.
- Local-provider failure and cloud-provider failure both degrade safely to deterministic behavior.

### Model/runtime smoke tests

- Exact pinned model revision and quantization load successfully.
- Chat template is confirmed compatible; repeated prompts do not loop indefinitely.
- A small fixed observation set returns bounded, parseable proposals.
- Measure latency, peak RAM, output length, invalid-output rate, and repeated-action rate on the target device.
- Compare behavior on identical seeded observations to detect regressions.

### Live Minecraft tests

Use a disposable world/server and report the exact game version, runtime/model revision, quantization, test scenario, and outcome. At minimum test: peaceful navigation, a single nearby hostile mob, multiple mobs, low health, valuable inventory, retreat followed by reassessment, provider loss during combat, and a reconnect/restart. Keep combat actions disabled until reflex cancellation, movement ownership, and safe fallback are demonstrated.

### Acceptance checklist

- [ ] Exact Andy model revision, quantization, runtime, and template are pinned.
- [ ] Python inference is behind a replaceable provider interface.
- [ ] Node adapter validates all responses before they reach the action coordinator.
- [ ] Mineflayer entity tracking powers the initial reflex path; no VLM dependency is added.
- [ ] Reflex behavior is independent of local/cloud LLM latency and availability.
- [ ] One coordinator owns movement/combat actions.
- [ ] Combat planning includes equipment, enemy count/type, terrain, and death-loss cost.
- [ ] Invalid output and model failures degrade safely.
- [ ] Unit tests and live Minecraft results are reported separately.
- [ ] No claim of successful integration is made until implementation and tests actually pass.

## 11. Out of scope

- VLM, screenshot ingestion, or custom vision training.
- Using Andy for player-facing chat or Discord responses.
- Letting model output call Mineflayer methods directly.
- Unbounded autonomous combat, PvP, or unrestricted action generation.
- Online training, self-modifying weights, or automatic fine-tuning during gameplay.
- Replacing the existing task lifecycle, safety policy, or single action coordinator.
- Claiming autonomous progression to diamond armor without a reproducible live test.
