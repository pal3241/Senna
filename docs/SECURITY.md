# Security boundaries

- Connect only accounts and servers the owner controls or is authorized to use; obey server rules and anticheat policies.
- PVP, terrain changes, building, mining, authentication automation, and AI planning are not implemented as gameplay actions. The defaults must remain restrictive when they are added.
- Every Discord command requires an allowlisted owner or admin role and is restricted to configured guild/channel IDs when set.
- Discord input and Minecraft observations are untrusted. Discord text is never forwarded to Minecraft chat.
- `.env` is excluded from source control. Logger error serializers redact environment secrets, and Discord output suppresses mentions.
- Community JavaScript modules execute with full Node process privileges when explicitly trusted. Manifest validation is not a sandbox. Untrusted modules are never imported; there is no process isolation in the current build.
- Modules receive no raw Mineflayer bot. Gameplay actions will be exposed only through the action coordinator.
- LLM and VLM providers are not implemented. Future model output must be schema-validated proposals and cannot directly execute code or actions.
- SQLite tasks and alerts persist locally under `SENA_DATA_DIR`; protect that directory as private runtime data and back it up using an offline copy while Sena is stopped.
