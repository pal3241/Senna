import { describe, expect, it } from "vitest";
import { configSchema } from "../src/core/config.js";

describe("configuration safety", () => {
  it("boots offline without credentials", () => {
    expect(configSchema.parse({}).SENA_MODE).toBe("offline");
  });

  it("requires Minecraft connection details for online mode", () => {
    expect(configSchema.safeParse({ SENA_MODE: "online" }).success).toBe(false);
  });

  it("keeps LLM and VLM credentials independent", () => {
    expect(
      configSchema.safeParse({ AI_LLM_PROVIDER: "nvidia-nim" }).success,
    ).toBe(false);
    expect(
      configSchema.safeParse({ AI_VLM_PROVIDER: "nvidia-nim" }).success,
    ).toBe(false);
  });

  it("parses owner allowlists as IDs", () => {
    expect(
      configSchema.parse({ DISCORD_OWNER_IDS: "123, 456" }).DISCORD_OWNER_IDS,
    ).toEqual(["123", "456"]);
  });
});
