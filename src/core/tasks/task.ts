import { z } from "zod";

export const taskStatuses = [
  "queued",
  "planning",
  "ready",
  "running",
  "waiting",
  "paused",
  "blocked",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const taskSchema = z.object({
  id: z.string().uuid(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  source: z.enum(["discord", "goal-manager", "recovery", "system"]),
  ownerId: z.string().max(128).nullable(),
  goal: z.string().min(1).max(2000),
  priority: z.number().int().min(0).max(100),
  status: z.enum(taskStatuses),
  deadlineAt: z.string().datetime().nullable(),
  retryCount: z.number().int().min(0),
  maxRetries: z.number().int().min(0).max(20),
  phase: z.string().max(128).nullable(),
  checkpoint: z.record(z.string(), z.unknown()),
  requiredCapabilities: z.array(z.string().max(128)),
  expectedResult: z.string().max(2000).nullable(),
  verification: z.record(z.string(), z.unknown()).nullable(),
  lastErrorCategory: z.string().max(128).nullable(),
  cancelRequested: z.boolean(),
});

export type TaskStatus = (typeof taskStatuses)[number];
export type Task = z.infer<typeof taskSchema>;

export const createTaskSchema = z.object({
  source: z.enum(["discord", "goal-manager", "recovery", "system"]),
  ownerId: z.string().max(128).nullable().optional(),
  goal: z.string().trim().min(1).max(2000),
  priority: z.number().int().min(0).max(100).default(50),
  deadlineAt: z.string().datetime().nullable().optional(),
  maxRetries: z.number().int().min(0).max(20).default(3),
  requiredCapabilities: z.array(z.string().max(128)).default([]),
  expectedResult: z.string().max(2000).nullable().optional(),
});

export type CreateTaskInput = z.input<typeof createTaskSchema>;

export class InvalidTaskTransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`Task cannot transition from ${from} to ${to}`);
    this.name = "InvalidTaskTransitionError";
  }
}
