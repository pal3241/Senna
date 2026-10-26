import { describe, expect, it } from "vitest";
import { Health } from "../src/core/health.js";

describe("runtime health mode", () => {
  it("combines Minecraft and LLM state without overwriting either dimension", () => {
    const health = new Health();

    health.update({ minecraft: "spawned", llm: "available" });
    expect(health.get()).toMatchObject({
      minecraft: "spawned",
      llm: "available",
      mode: "NORMAL",
    });

    health.update({ llm: "unavailable" });
    expect(health.get()).toMatchObject({
      minecraft: "spawned",
      llm: "unavailable",
      mode: "DEGRADED_NO_LLM",
    });

    health.update({ llm: "available", minecraft: "disconnected" });
    expect(health.get()).toMatchObject({
      minecraft: "disconnected",
      llm: "available",
      mode: "DISCONNECTED_MINECRAFT",
    });
  });

  it("keeps SAFE_HALT until an explicit mode refresh after resume", () => {
    const health = new Health();
    health.update({ minecraft: "spawned", llm: "available" });
    health.update({ mode: "SAFE_HALT" });
    health.update({ minecraft: "disconnected" });
    expect(health.get().mode).toBe("SAFE_HALT");
    health.refreshMode();
    expect(health.get().mode).toBe("DISCONNECTED_MINECRAFT");
  });
});
