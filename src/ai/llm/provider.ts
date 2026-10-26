export interface LlmMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface LlmProvider {
  complete(
    messages: readonly LlmMessage[],
    signal?: AbortSignal,
  ): Promise<string>;
}

export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
