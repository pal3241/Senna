import type { MinecraftAdapter } from "../adapters/minecraft/minecraft-adapter.js";
import type { SenaEventBus } from "../core/event-bus.js";
import type { CreateTaskInput, Task } from "../core/tasks/task.js";
import type { TaskRepository } from "../core/tasks/task-repository.js";
import { planSchema, validatePlan } from "../ai/planning/plan.js";
import type { GameplayActions, MoveTarget } from "./gameplay-actions.js";
import { moveTargetSchema } from "./gameplay-actions.js";
import {
  ActionCancelledError,
  getActionFailureOutcome,
} from "./action-coordinator.js";

const availableCapabilities = new Set(["minecraft.move_to"]);
const supportedMoveGoal = /^move_to\s+(-?\d{1,8})\s+(-?\d{1,8})\s+(-?\d{1,8})$/;

interface ActiveTaskRun {
  controller: AbortController;
  promise: Promise<Task>;
}

/** Runs only the explicit, deterministic move_to goal; all world mutations use GameplayActions. */
export class TaskExecutionService {
  private readonly active = new Map<string, ActiveTaskRun>();
  private readonly cancelling = new Set<string>();
  private readonly removeConnectionListener: () => void;

  constructor(
    private readonly tasks: TaskRepository,
    private readonly minecraft: MinecraftAdapter,
    private readonly actions: GameplayActions,
    events: SenaEventBus,
  ) {
    this.removeConnectionListener = events.on(
      "runtime.connection",
      ({ adapter, status }) => {
        if (adapter !== "minecraft" || status === "spawned") return;
        for (const taskRun of this.active.values())
          taskRun.controller.abort(new Error("minecraft-disconnected"));
      },
    );
  }

  submit(input: CreateTaskInput): Task {
    const task = this.tasks.create(input);
    const promise = this.execute(task.id);
    void promise.catch(() => undefined);
    return task;
  }

  execute(taskId: string): Promise<Task> {
    const existing = this.active.get(taskId);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.run(taskId, controller.signal).finally(() => {
      this.active.delete(taskId);
      this.cancelling.delete(taskId);
    });
    this.active.set(taskId, { controller, promise });
    return promise;
  }

  async cancel(taskId: string, reason = "task-cancelled"): Promise<Task> {
    const run = this.active.get(taskId);
    if (run) {
      this.cancelling.add(taskId);
      run.controller.abort(new ActionCancelledError(reason));
      await run.promise.catch(() => undefined);
    }
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    if (["succeeded", "failed", "cancelled"].includes(task.status)) return task;
    return this.tasks.requestCancellation(taskId);
  }

  async close(): Promise<void> {
    this.removeConnectionListener();
    for (const taskRun of this.active.values()) {
      taskRun.controller.abort(new Error("runtime-stopping"));
    }
    await Promise.all(
      [...this.active.values()].map((taskRun) =>
        taskRun.promise.catch(() => undefined),
      ),
    );
  }

  private async run(taskId: string, signal: AbortSignal): Promise<Task> {
    let task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "queued") return task;

    task = this.tasks.transition(taskId, "planning", "goal-validation-started");
    const target = parseMoveGoal(task.goal);
    if (!target) {
      return this.tasks.block(taskId, "unsupported-goal", {
        supportedFormat: "move_to <x> <y> <z>",
      });
    }

    const before = this.minecraft.getWorldSnapshot();
    if (before.connection !== "spawned") {
      return this.tasks.block(taskId, "minecraft-disconnected", {
        observedConnection: before.connection,
      });
    }
    if (before.position.status !== "known" || !before.position.value) {
      return this.tasks.block(taskId, "position-unknown");
    }
    if (distance(before.position.value, target) > 48) {
      return this.tasks.block(taskId, "move-out-of-bounds", {
        maxDistance: 48,
      });
    }
    if (signal.aborted) return this.cancelledOrBlocked(taskId);

    const plan = planSchema.parse({
      summary: `Navigate to ${target.x}, ${target.y}, ${target.z}`,
      steps: [
        {
          capability: "minecraft.move_to",
          rationale: "Explicit bounded coordinate goal from the task owner",
          input: target,
          preconditions: ["Minecraft spawned", "fresh finite player position"],
          successCriteria:
            "Fresh observed position is within 1.75 blocks of target",
          timeoutSeconds: 120,
          risk: "low",
        },
      ],
      requiresOwnerApproval: false,
    });
    validatePlan(plan, availableCapabilities);

    task = this.tasks.transition(taskId, "ready", "goal-validated", {
      capability: "minecraft.move_to",
    });
    task = this.tasks.transition(taskId, "running", "action-started", {
      capability: "minecraft.move_to",
    });
    try {
      const actionResult = await this.actions.moveTo(
        task.id,
        task.ownerId ?? "system",
        target,
        signal,
      );
      const evidence = actionResult.result;
      return this.tasks.complete(
        task.id,
        "move-verified",
        { capability: actionResult.kind, ...evidence },
        {
          status: "known",
          criterion: "within-1.75-blocks",
          distance: evidence.distance,
          observedAt: evidence.observedAt,
        },
      );
    } catch (error) {
      const current = this.tasks.get(taskId);
      if (
        !current ||
        this.cancelling.has(taskId) ||
        current.status === "cancelled"
      )
        return current ?? task;
      const disconnected =
        signal.reason instanceof Error &&
        signal.reason.message === "minecraft-disconnected";
      const actionOutcome = getActionFailureOutcome(error);
      const cleanupSucceeded = actionOutcome?.cleanup === "completed";
      return this.tasks.block(
        taskId,
        disconnected ? "minecraft-disconnected" : errorCategory(error),
        {
          actionStopped: cleanupSucceeded ? "confirmed" : "unknown",
          resourceReleased: actionOutcome
            ? cleanupSucceeded
              ? "confirmed"
              : "failed"
            : "unknown",
          coordinatorLaneReleased:
            actionOutcome?.actionLaneReleased ?? "unknown",
          resumable: false,
          reason: errorCategory(error),
        },
      );
    }
  }

  private cancelledOrBlocked(taskId: string): Task {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error("Task not found");
    if (this.cancelling.has(taskId) || task.status === "cancelled") return task;
    return this.tasks.block(taskId, "execution-cancelled", {
      reason: "cancelled",
    });
  }
}

export function parseMoveGoal(goal: string): MoveTarget | null {
  const match = supportedMoveGoal.exec(goal.trim());
  if (!match) return null;
  const target = moveTargetSchema.safeParse({
    x: Number(match[1]),
    y: Number(match[2]),
    z: Number(match[3]),
  });
  return target.success ? target.data : null;
}

function distance(a: MoveTarget, b: MoveTarget): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function errorCategory(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "ActionTimeoutError") return "action-timeout";
    if (error.name === "ActionVerificationError")
      return "postcondition-unverified";
    if (error.name === "ActionPreconditionError") return "precondition-failed";
    if (error.name === "ActionCancelledError") return "action-cancelled";
  }
  return "action-failed";
}
