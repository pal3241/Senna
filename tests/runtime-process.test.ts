import { spawn } from "node:child_process";
import { once } from "node:events";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("runtime process", () => {
  it("stays alive in offline mode and exits cleanly on SIGTERM", async () => {
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        SENA_MODE: "offline",
        SENA_DATA_DIR: ":memory:",
        SENA_MODULES_DIR: resolve("modules"),
        LOG_LEVEL: "info",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    let startupTimer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        new Promise<void>((resolveReady, reject) => {
          child.stdout.on("data", () => {
            if (output.includes("Sena core started")) resolveReady();
          });
          child.once("error", reject);
          child.once("exit", (code) => {
            if (!output.includes("Sena core started")) {
              reject(new Error(`Sena exited before startup with code ${code}`));
            }
          });
        }),
        new Promise<never>((_, reject) => {
          startupTimer = setTimeout(
            () => reject(new Error("Sena startup timed out")),
            30_000,
          );
        }),
      ]);
      if (startupTimer) clearTimeout(startupTimer);
      expect(child.exitCode).toBeNull();
      const exitPromise = once(child, "exit");
      child.kill("SIGTERM");
      const [code, signal] = (await exitPromise) as [
        number | null,
        NodeJS.Signals | null,
      ];
      expect(code).toBe(0);
      expect(signal).toBeNull();
    } finally {
      if (startupTimer) clearTimeout(startupTimer);
      if (child.exitCode === null) {
        const exitPromise = once(child, "exit");
        child.kill("SIGKILL");
        await exitPromise;
      }
    }
  }, 40_000);
});
