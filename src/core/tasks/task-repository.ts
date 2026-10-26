import { randomUUID } from "node:crypto";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { redactText } from "../logger.js";
import type { SenaEventBus } from "../event-bus.js";
import {
  createTaskSchema,
  InvalidTaskTransitionError,
  taskSchema,
  type CreateTaskInput,
  type Task,
  type TaskStatus,
} from "./task.js";

const transitions: Record<TaskStatus, ReadonlySet<TaskStatus>> = {
  queued: new Set(["planning", "paused", "cancelled"]),
  planning: new Set([
    "ready",
    "blocked",
    "failed",
    "paused",
    "cancelled",
    "interrupted",
  ]),
  ready: new Set(["running", "paused", "cancelled", "interrupted"]),
  running: new Set([
    "waiting",
    "succeeded",
    "failed",
    "blocked",
    "paused",
    "cancelled",
    "interrupted",
  ]),
  waiting: new Set([
    "ready",
    "running",
    "blocked",
    "paused",
    "cancelled",
    "interrupted",
  ]),
  paused: new Set(["queued", "ready", "cancelled"]),
  blocked: new Set(["queued", "planning", "cancelled"]),
  succeeded: new Set(),
  failed: new Set(["queued"]),
  cancelled: new Set(),
  interrupted: new Set(["planning", "ready", "paused", "cancelled"]),
};

type TaskRow = {
  id: string;
  created_at: string;
  updated_at: string;
  source: Task["source"];
  owner_id: string | null;
  goal: string;
  priority: number;
  status: TaskStatus;
  deadline_at: string | null;
  retry_count: number;
  max_retries: number;
  phase: string | null;
  checkpoint_json: string;
  capabilities_json: string;
  expected_result: string | null;
  verification_json: string | null;
  last_error_category: string | null;
  cancel_requested: number;
};

export class TaskRepository {
  private readonly insertTask: StatementSync;
  private readonly updateTask: StatementSync;
  private readonly selectTask: StatementSync;
  private readonly insertEvent: StatementSync;
  private readonly updateCheckpoint: StatementSync;

  constructor(
    private readonly db: DatabaseSync,
    private readonly events: SenaEventBus,
  ) {
    this.insertTask = db.prepare(`INSERT INTO tasks (
      id, created_at, updated_at, source, owner_id, goal, priority, status,
      deadline_at, retry_count, max_retries, phase, checkpoint_json,
      capabilities_json, expected_result, verification_json, last_error_category,
      cancel_requested
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    this.updateTask =
      db.prepare(`UPDATE tasks SET status = ?, updated_at = ?, retry_count = ?,
      phase = ?, verification_json = ?, last_error_category = ?, cancel_requested = ? WHERE id = ?`);
    this.selectTask = db.prepare("SELECT * FROM tasks WHERE id = ?");
    this.insertEvent = db.prepare(`INSERT INTO task_events
      (task_id, at, from_status, to_status, event_type, detail_json) VALUES (?, ?, ?, ?, ?, ?)`);
    this.updateCheckpoint = db.prepare(
      "UPDATE tasks SET checkpoint_json = ?, phase = ?, updated_at = ? WHERE id = ?",
    );
  }

  create(input: CreateTaskInput): Task {
    const parsed = createTaskSchema.parse(input);
    const now = new Date().toISOString();
    const id = randomUUID();
    const goal = redactText(parsed.goal);
    this.transaction(() => {
      this.insertTask.run(
        id,
        now,
        now,
        parsed.source,
        parsed.ownerId ?? null,
        goal,
        parsed.priority,
        "queued",
        parsed.deadlineAt ?? null,
        0,
        parsed.maxRetries,
        null,
        "{}",
        JSON.stringify(parsed.requiredCapabilities),
        parsed.expectedResult ? redactText(parsed.expectedResult) : null,
        null,
        null,
        0,
      );
      this.recordEvent(id, null, "queued", "created", {
        source: parsed.source,
      });
    });
    this.events.emit("task.created", { taskId: id, source: parsed.source });
    return this.get(id)!;
  }

  get(id: string): Task | null {
    const row = this.selectTask.get(id) as TaskRow | undefined;
    return row ? this.fromRow(row) : null;
  }

  list(status?: TaskStatus, limit = 100): Task[] {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = status
      ? this.db
          .prepare(
            "SELECT * FROM tasks WHERE status = ? ORDER BY priority DESC, created_at ASC LIMIT ?",
          )
          .all(status, safeLimit)
      : this.db
          .prepare(
            "SELECT * FROM tasks ORDER BY priority DESC, created_at ASC LIMIT ?",
          )
          .all(safeLimit);
    return (rows as TaskRow[]).map((row) => this.fromRow(row));
  }

  transition(
    id: string,
    to: TaskStatus,
    eventType = "transition",
    detail: Record<string, unknown> = {},
  ): Task {
    let from: TaskStatus;
    this.transaction(() => {
      const current = this.require(id);
      from = current.status;
      if (!transitions[from].has(to))
        throw new InvalidTaskTransitionError(from, to);
      const now = new Date().toISOString();
      this.updateTask.run(
        to,
        now,
        current.retryCount,
        current.phase,
        current.verification ? JSON.stringify(current.verification) : null,
        current.lastErrorCategory,
        to === "cancelled" || current.cancelRequested ? 1 : 0,
        id,
      );
      this.recordEvent(id, from, to, eventType, detail);
    });
    this.events.emit("task.changed", { taskId: id, status: to });
    return this.get(id)!;
  }

  failAttempt(
    id: string,
    category: string,
    detail: Record<string, unknown> = {},
  ): Task {
    let nextStatus: TaskStatus;
    this.transaction(() => {
      const current = this.require(id);
      if (!transitions[current.status].has("failed")) {
        throw new InvalidTaskTransitionError(current.status, "failed");
      }
      const retries = current.retryCount + 1;
      nextStatus = retries <= current.maxRetries ? "queued" : "failed";
      const now = new Date().toISOString();
      this.updateTask.run(
        nextStatus,
        now,
        retries,
        current.phase,
        null,
        category.slice(0, 128),
        0,
        id,
      );
      this.recordEvent(id, current.status, nextStatus, "attempt-failed", {
        ...detail,
        category: category.slice(0, 128),
        retryCount: retries,
      });
    });
    this.events.emit("task.changed", { taskId: id, status: nextStatus! });
    return this.get(id)!;
  }

  checkpoint(
    id: string,
    phase: string | null,
    checkpoint: Record<string, unknown>,
  ): Task {
    const current = this.require(id);
    const bounded = JSON.stringify(checkpoint);
    if (bounded.length > 32_000)
      throw new Error("Task checkpoint exceeds 32 KB");
    const safePhase = phase?.slice(0, 128) ?? null;
    const safeCheckpoint = redactText(bounded);
    this.transaction(() => {
      this.updateCheckpoint.run(
        safeCheckpoint,
        safePhase,
        new Date().toISOString(),
        id,
      );
      this.recordEvent(id, current.status, current.status, "checkpoint", {
        phase: safePhase,
      });
    });
    return this.get(id)!;
  }

  requestCancellation(id: string): Task {
    const current = this.require(id);
    if (
      current.status === "succeeded" ||
      current.status === "failed" ||
      current.status === "cancelled"
    ) {
      throw new InvalidTaskTransitionError(current.status, "cancelled");
    }
    return this.transition(id, "cancelled", "cancellation-requested");
  }

  recoverActiveTasks(): number {
    const active = this.db
      .prepare(
        "SELECT id FROM tasks WHERE status IN ('planning', 'ready', 'running', 'waiting')",
      )
      .all() as { id: string }[];
    this.transaction(() => {
      const now = new Date().toISOString();
      const update = this.db.prepare(
        "UPDATE tasks SET status = 'interrupted', updated_at = ?, last_error_category = 'process-restart' WHERE id = ?",
      );
      for (const { id } of active) {
        update.run(now, id);
        this.recordEvent(id, null, "interrupted", "process-recovery", {
          reconcileBeforeResume: true,
        });
      }
    });
    return active.length;
  }

  eventsFor(id: string, limit = 100): Array<Record<string, unknown>> {
    const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
    const rows = this.db
      .prepare(
        `SELECT sequence, at, from_status AS fromStatus, to_status AS toStatus,
      event_type AS eventType, detail_json AS detailJson FROM task_events WHERE task_id = ?
      ORDER BY sequence DESC LIMIT ?`,
      )
      .all(id, safeLimit) as Array<{
      sequence: number;
      at: string;
      fromStatus: string | null;
      toStatus: string;
      eventType: string;
      detailJson: string;
    }>;
    return rows.map(({ detailJson, ...event }) => ({
      ...event,
      detail: JSON.parse(detailJson) as unknown,
    }));
  }

  private require(id: string): Task {
    const task = this.get(id);
    if (!task) throw new Error(`Task ${id} does not exist`);
    return task;
  }

  private recordEvent(
    id: string,
    from: TaskStatus | null,
    to: TaskStatus,
    type: string,
    detail: Record<string, unknown>,
  ): void {
    this.insertEvent.run(
      id,
      new Date().toISOString(),
      from,
      to,
      type.slice(0, 128),
      redactText(JSON.stringify(detail)),
    );
  }

  private fromRow(row: TaskRow): Task {
    return taskSchema.parse({
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      source: row.source,
      ownerId: row.owner_id,
      goal: row.goal,
      priority: row.priority,
      status: row.status,
      deadlineAt: row.deadline_at,
      retryCount: row.retry_count,
      maxRetries: row.max_retries,
      phase: row.phase,
      checkpoint: JSON.parse(row.checkpoint_json) as Record<string, unknown>,
      requiredCapabilities: JSON.parse(row.capabilities_json) as string[],
      expectedResult: row.expected_result,
      verification: row.verification_json
        ? (JSON.parse(row.verification_json) as Record<string, unknown>)
        : null,
      lastErrorCategory: row.last_error_category,
      cancelRequested: row.cancel_requested === 1,
    });
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
