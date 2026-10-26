import { describe, expect, it } from "vitest";
import { NvidiaNimProvider } from "../src/ai/llm/nvidia-nim-provider.js";
import { Planner } from "../src/ai/planning/planner.js";
import type { LlmProvider } from "../src/ai/llm/provider.js";

const plan = {
  summary: "Observe nearby area",
  steps: [
    {
      capability: "world.observe",
      rationale: "Refresh stale world facts",
      input: {},
      preconditions: [],
      successCriteria: "Observation timestamp is current",
      timeoutSeconds: 30,
      risk: "low",
    },
  ],
  requiresOwnerApproval: false,
};

class FakeProvider implements LlmProvider {
  constructor(private readonly value: string) {}
  async complete(): Promise<string> {
    return this.value;
  }
}

describe("AI planning boundary", () => {
  it("accepts schema-valid plans using only registered capabilities", async () => {
    const planner = new Planner(new FakeProvider(JSON.stringify(plan)));
    await expect(
      planner.propose({
        goal: "Explore",
        knownFacts: [],
        availableCapabilities: ["world.observe"],
      }),
    ).resolves.toEqual(plan);
  });

  it("rejects invented or unregistered capabilities", async () => {
    const planner = new Planner(
      new FakeProvider(
        JSON.stringify({
          ...plan,
          steps: [{ ...plan.steps[0], capability: "player.attack" }],
        }),
      ),
    );
    await expect(
      planner.propose({
        goal: "Explore",
        knownFacts: [],
        availableCapabilities: [],
      }),
    ).rejects.toThrow("unavailable capabilities");
  });

  it("requires approval for high-risk plans and rejects malformed output", async () => {
    const highRisk = {
      ...plan,
      requiresOwnerApproval: false,
      steps: [{ ...plan.steps[0], risk: "high" }],
    };
    await expect(
      new Planner(new FakeProvider(JSON.stringify(highRisk))).propose({
        goal: "Do something",
        knownFacts: [],
        availableCapabilities: ["world.observe"],
      }),
    ).rejects.toThrow("require owner approval");
    await expect(
      new Planner(new FakeProvider("not json")).propose({
        goal: "Do something",
        knownFacts: [],
        availableCapabilities: [],
      }),
    ).rejects.toThrow("malformed JSON");
  });

  it("uses the documented NIM chat endpoint and does not leak provider errors", async () => {
    let requestedUrl = "";
    let requestedHeaders = new Headers();
    const provider = new NvidiaNimProvider({
      apiKey: "test-secret",
      model: "provider/model",
      fetchImpl: async (input, init) => {
        requestedUrl = String(input);
        requestedHeaders = new Headers(init?.headers);
        return new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        );
      },
    });
    await expect(
      provider.complete([{ role: "user", content: "hello" }]),
    ).resolves.toBe("ok");
    expect(requestedUrl).toBe(
      "https://integrate.api.nvidia.com/v1/chat/completions",
    );
    expect(requestedHeaders.get("authorization")).toBe("Bearer test-secret");

    const broken = new NvidiaNimProvider({
      apiKey: "test-secret",
      model: "provider/model",
      fetchImpl: async () =>
        new Response("provider internals", { status: 503 }),
    });
    await expect(
      broken.complete([{ role: "user", content: "hello" }]),
    ).rejects.toThrow("HTTP 503");
  });
});
