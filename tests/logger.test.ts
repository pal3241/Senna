import { afterEach, describe, expect, it, vi } from "vitest";
import { redactText, safeFields } from "../src/core/logger.js";

describe("secret redaction", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("redacts configured secret values, including short passwords", () => {
    vi.stubEnv("MINECRAFT_PASSWORD", "abc123");
    expect(redactText("login failed for abc123")).toBe(
      "login failed for [REDACTED]",
    );
  });

  it("redacts secret-like fields", () => {
    expect(safeFields({ token: "sensitive", status: "connected" })).toEqual({
      token: "[REDACTED]",
      status: "connected",
    });
  });
});
