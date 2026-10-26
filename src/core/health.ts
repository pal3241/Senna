export type RuntimeMode =
  | "NORMAL"
  | "DEGRADED_NO_LLM"
  | "DEGRADED_NO_VLM"
  | "OFFLINE_AI"
  | "DISCONNECTED_MINECRAFT"
  | "DISCONNECTED_DISCORD"
  | "SAFE_HALT";

export interface HealthSnapshot {
  lifecycle: "starting" | "running" | "stopping" | "stopped";
  mode: RuntimeMode;
  minecraft: "disabled" | "disconnected" | "connecting" | "spawned" | "failed";
  discord: "disabled" | "disconnected" | "connected" | "failed";
  llm: "disabled" | "available" | "unavailable";
  vlm: "disabled" | "available" | "unavailable";
  persistence: "healthy" | "failed";
  updatedAt: string;
}

export class Health {
  private snapshot: HealthSnapshot = {
    lifecycle: "starting",
    mode: "OFFLINE_AI",
    minecraft: "disabled",
    discord: "disabled",
    llm: "disabled",
    vlm: "disabled",
    persistence: "healthy",
    updatedAt: new Date().toISOString(),
  };

  get(): Readonly<HealthSnapshot> {
    return { ...this.snapshot };
  }

  update(
    patch: Partial<Omit<HealthSnapshot, "updatedAt">>,
  ): Readonly<HealthSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    return this.get();
  }
}
