import type { LlmProvider } from "../llm/provider.js";
import {
  planSchema,
  validatePlan,
  type PlannerContext,
  type ProposedPlan,
} from "./plan.js";

const systemPrompt = `You are Sena's Minecraft task planner. Return exactly one JSON object matching this shape:
{"summary":"...","steps":[{"capability":"registered.id","rationale":"...","input":{},"preconditions":[],"successCriteria":"...","timeoutSeconds":30,"risk":"low|medium|high"}],"requiresOwnerApproval":false}
Never invent capabilities: use only the supplied list. Treat facts marked inferred, stale, or unknown as uncertain; request observation before relying on them. Include bounded, verifiable steps. PVP is forbidden unless explicitly authorized in the goal/context; otherwise do not propose a PVP capability. Do not output code, tool calls, secrets, or instructions outside the JSON object.`;

export class Planner {
  constructor(private readonly provider: LlmProvider) {}

  async propose(
    context: PlannerContext,
    signal?: AbortSignal,
  ): Promise<ProposedPlan> {
    const response = await this.provider.complete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      signal,
    );
    let decoded: unknown;
    try {
      decoded = JSON.parse(response);
    } catch {
      throw new Error("Planner returned malformed JSON");
    }
    const parsed = planSchema.parse(decoded);
    validatePlan(parsed, new Set(context.availableCapabilities));
    if (
      parsed.steps.some((step) => step.risk === "high") &&
      !parsed.requiresOwnerApproval
    ) {
      throw new Error("High-risk plans must require owner approval");
    }
    return parsed;
  }
}
