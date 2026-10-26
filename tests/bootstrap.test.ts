import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap } from "../src/app/bootstrap.js";

describe("offline runtime", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts and stops without external credentials", async () => {
    vi.stubEnv("SENA_MODE", "offline");
    vi.stubEnv("DISCORD_BOT_TOKEN", "");
    vi.stubEnv("MINECRAFT_HOST", "");
    vi.stubEnv("MINECRAFT_USERNAME", "");
    vi.stubEnv("SENA_DATA_DIR", ":memory:");
    const runtime = await bootstrap();
    await runtime.start();
    expect(runtime.health.get().lifecycle).toBe("running");
    const assess = runtime.modules.getCapability("reflex-health-assessment");
    expect(assess).toBeDefined();
    expect(assess?.({ health: 3 })).toMatchObject({
      urgency: "critical",
    });
    await runtime.stop("test");
    expect(runtime.health.get().lifecycle).toBe("stopped");
  });
});
