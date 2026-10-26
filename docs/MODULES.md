# Sena modules

Each direct child of `modules/` must contain `module.json`. Internal module layout is otherwise owned by the module author; `entry` points to its JavaScript module file.

## Trust and execution

Manifest validation does not make JavaScript safe. Trusted modules run in the Sena process and therefore have Node.js process privileges. Sena automatically trusts only the release's `basic` built-in module. A local extension must be explicitly trusted by exact ID in `SENA_TRUSTED_MODULE_IDS`, a comma-separated environment variable. Untrusted code is discovered and reported but never imported.

The current host provides module ID, a sanitized mode setting, a scoped logger, declared capability registration, and allowlisted event subscriptions. It never gives modules the raw Mineflayer bot. Permissions such as world, task, action, and memory access are schema-recognized but cause the module to remain inactive until those APIs are implemented. There is no process sandbox yet.

## Manifest

```json
{
  "schema_version": "1.0",
  "id": "basic",
  "name": "Basic Reflex",
  "version": "1.0.0",
  "description": "A deterministic health assessment capability.",
  "entry": "index.js",
  "api_version": "^1.0.0",
  "capabilities": ["reflex-health-assessment"],
  "dependencies": [],
  "permissions": ["events.subscribe"],
  "enabled_by_default": true
}
```

The schema rejects unknown fields, invalid IDs/versions/permissions, duplicate declarations, incompatible core API ranges, and entry paths that traverse or resolve outside the module folder. Dependencies are ordered before consumers; duplicate IDs, cycles, and dependencies on missing, incompatible, or untrusted modules are isolated.

## Current API

`start(api)` may register a handler for a capability declared in the manifest, subscribe to a typed runtime event when `events.subscribe` is declared, and report `ready` or `degraded` health. `stop()` is optional. Event subscriptions are automatically removed during cleanup. The API is intentionally small until the action coordinator and world/task services exist.
