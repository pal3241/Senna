# AI planning

The optional NVIDIA NIM LLM adapter uses the documented OpenAI-compatible chat completions endpoint. Set `AI_LLM_PROVIDER=nvidia-nim`, `NVIDIA_NIM_LLM_API_KEY`, and `NVIDIA_NIM_LLM_MODEL`; the default base URL is `https://integrate.api.nvidia.com/v1`. A custom base URL is available for compatible NIM deployments. LLM and VLM keys/configuration are separate.

The planner asks for a bounded JSON proposal. It parses the response locally, enforces field and size limits, rejects unregistered capabilities, and requires owner approval for any high-risk plan. It sends only the supplied goal, available capability names, and world facts; callers must keep those inputs free of credentials and personal data.

The planner is not an execution engine. It is not yet connected to task scheduling, action handlers, memory, or a VLM. Offline mode and all tests work without NVIDIA credentials. Tests use a fake provider; live model availability, model-specific output quality, and external API behavior have not been validated. NVIDIA documents the endpoint at [LLM APIs](https://docs.api.nvidia.com/nim/reference/llm-apis).
