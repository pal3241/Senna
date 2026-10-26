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
    const shouldDeriveMode =
      patch.mode === undefined &&
      (patch.minecraft !== undefined || patch.llm !== undefined) &&
      this.snapshot.mode !== "SAFE_HALT";
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      ...(shouldDeriveMode
        ? { mode: deriveRuntimeMode({ ...this.snapshot, ...patch }) }
        : {}),
      updatedAt: new Date().toISOString(),
    };
    return this.get();
  }

  refreshMode(): Readonly<HealthSnapshot> {
    this.snapshot = {
      ...this.snapshot,
      mode: deriveRuntimeMode(this.snapshot),
      updatedAt: new Date().toISOString(),
    };
    return this.get();
  }
}

export function deriveRuntimeMode(snapshot: HealthSnapshot): RuntimeMode {
  if (snapshot.minecraft === "disabled" && snapshot.llm !== "available")
    return "OFFLINE_AI";
  if (snapshot.minecraft !== "spawned") return "DISCONNECTED_MINECRAFT";
  return snapshot.llm === "available" ? "NORMAL" : "DEGRADED_NO_LLM";
}
