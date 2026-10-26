import {
  LlmProviderError,
  type LlmMessage,
  type LlmProvider,
} from "./provider.js";

interface NvidiaResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: unknown };
  }[];
}

export interface NvidiaNimOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly fetchImpl?: typeof fetch;
}

export class NvidiaNimProvider implements LlmProvider {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly options: NvidiaNimOptions) {
    this.endpoint = `${(options.baseUrl || "https://integrate.api.nvidia.com/v1").replace(/\/+$/, "")}/chat/completions`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    if (!options.apiKey.trim() || !options.model.trim()) {
      throw new Error("NVIDIA NIM API key and model are required");
    }
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error("NVIDIA NIM timeout must be a positive integer");
    }
  }

  async complete(
    messages: readonly LlmMessage[],
    signal?: AbortSignal,
  ): Promise<string> {
    if (messages.length === 0)
      throw new Error("At least one LLM message is required");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: this.options.model,
          messages,
          stream: false,
          temperature: 0.1,
          max_tokens: 1200,
        }),
        signal: requestSignal,
      });
    } catch {
      if (signal?.aborted)
        throw new LlmProviderError("LLM request cancelled", false);
      if (timeout.aborted)
        throw new LlmProviderError("LLM request timed out", true);
      throw new LlmProviderError("NVIDIA NIM request failed", true);
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new LlmProviderError(
        `NVIDIA NIM returned HTTP ${response.status}`,
        retryable,
      );
    }
    let payload: NvidiaResponse;
    try {
      payload = (await response.json()) as NvidiaResponse;
    } catch {
      throw new LlmProviderError("NVIDIA NIM returned invalid JSON", true);
    }
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new LlmProviderError(
        "NVIDIA NIM response contained no text",
        false,
      );
    }
    return content;
  }
}
