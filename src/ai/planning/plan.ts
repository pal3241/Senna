import { z } from "zod";

export const planSchema = z.object({
  summary: z.string().min(1).max(500),
  steps: z
    .array(
      z.object({
        capability: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/),
        rationale: z.string().min(1).max(300),
        input: z.record(z.string(), z.unknown()).default({}),
        preconditions: z.array(z.string().min(1).max(200)).max(8).default([]),
        successCriteria: z.string().min(1).max(300),
        timeoutSeconds: z.number().int().min(1).max(600),
        risk: z.enum(["low", "medium", "high"]),
      }),
    )
    .min(1)
    .max(12),
  requiresOwnerApproval: z.boolean(),
});

export type ProposedPlan = z.infer<typeof planSchema>;

export interface PlannerContext {
  readonly goal: string;
  readonly knownFacts: readonly {
    readonly fact: string;
    readonly certainty: "known" | "inferred" | "stale" | "unknown";
    readonly source: string;
    readonly observedAt: string;
  }[];
  readonly availableCapabilities: readonly string[];
}

export interface ValidatedPlan {
  readonly plan: ProposedPlan;
  readonly rejectedCapabilities: readonly string[];
}

export function validatePlan(
  value: unknown,
  capabilities: ReadonlySet<string>,
): ValidatedPlan {
  const plan = planSchema.parse(value);
  const rejectedCapabilities = [
    ...new Set(
      plan.steps
        .filter((step) => !capabilities.has(step.capability))
        .map((step) => step.capability),
    ),
  ];
  if (rejectedCapabilities.length) {
    throw new Error(
      `Plan requests unavailable capabilities: ${rejectedCapabilities.join(", ")}`,
    );
  }
  return { plan, rejectedCapabilities };
}
