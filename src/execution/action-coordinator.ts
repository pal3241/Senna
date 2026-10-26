import { randomUUID } from "node:crypto";
import { redactText } from "../core/logger.js";

export type ActionResource =
  | "movement"
  | "digging"
  | "combat"
  | "placement"
  | "equipment"
  | "authentication-chat";

export type ActionStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ActionCleanupReason =
  "success" | "failure" | "cancelled" | "timeout";

export interface ActionFailureOutcome {
  cleanup: "completed" | "failed";
  actionLaneReleased: true;
}

const failureOutcomes = new WeakMap<object, ActionFailureOutcome>();

export function getActionFailureOutcome(
  error: unknown,
): ActionFailureOutcome | null {
  return error !== null &&
    (typeof error === "object" || typeof error === "function")
    ? (failureOutcomes.get(error) ?? null)
    : null;
}

export interface ActionDefinition<T> {
  taskId: string;
  owner: string;
  kind: string;
  resources: readonly ActionResource[];
  timeoutMs: number;
  deadlineAt?: string;
  signal?: AbortSignal;
  precondition(): boolean | Promise<boolean>;
  run(signal: AbortSignal): T | Promise<T>;
  verify(result: T): boolean | Promise<boolean>;
  cleanup?(reason: ActionCleanupReason): void | Promise<void>;
}

export interface ActionResult<T> {
  actionId: string;
  taskId: string;
  kind: string;
  status: "succeeded";
  startedAt: string;
  finishedAt: string;
  result: T;
  verified: true;
}

export class ActionPreconditionError extends Error {
  constructor(kind: string) {
    super(`Action precondition was not met: ${kind}`);
    this.name = "ActionPreconditionError";
  }
}

export class ActionVerificationError extends Error {
  constructor(kind: string) {
    super(`Action postcondition was not verified: ${kind}`);
    this.name = "ActionVerificationError";
  }
}

export class ActionCancelledError extends Error {
  constructor(reason = "Action was cancelled") {
    super(reason);
    this.name = "ActionCancelledError";
  }
}

export class ActionTimeoutError extends Error {
  constructor(kind: string) {
    super(`Action timed out: ${kind}`);
    this.name = "ActionTimeoutError";
  }
}

interface QueuedAction<T = unknown> {
  id: string;
  definition: ActionDefinition<T>;
  controller: AbortController;
  resolve(result: ActionResult<T>): void;
  reject(error: unknown): void;
  detachExternalSignal?: () => void;
}

export interface ActionCoordinatorOptions {
  onSafeHalt?: (reason: string) => void;
  maxTimeoutMs?: number;
  cleanupTimeoutMs?: number;
}

/** A single FIFO action lane: movement, inventory, combat, and placement never overlap. */
export class ActionCoordinator {
  private readonly queue: QueuedAction[] = [];
  private active: QueuedAction | null = null;
  private pumping = false;
  private stopping = false;
  private paused = false;
  private safeHalted = false;
  private safeHaltReason: string | null = null;
  private readonly maxTimeoutMs: number;
  private readonly cleanupTimeoutMs: number;

  constructor(private readonly options: ActionCoordinatorOptions = {}) {
    this.maxTimeoutMs = options.maxTimeoutMs ?? 10 * 60_000;
    this.cleanupTimeoutMs = options.cleanupTimeoutMs ?? 5_000;
  }

  execute<T>(definition: ActionDefinition<T>): Promise<ActionResult<T>> {
    validateDefinition(definition, this.maxTimeoutMs);
    if (this.stopping)
      return Promise.reject(new Error("Action coordinator is stopping"));
    if (this.safeHalted)
      return Promise.reject(
        new ActionCancelledError(
          this.safeHaltReason ?? "Runtime is in SAFE_HALT",
        ),
      );
    if (this.paused)
      return Promise.reject(
        new ActionCancelledError("Action coordinator is paused"),
      );
    const action: QueuedAction<T> = {
      id: randomUUID(),
      definition,
      controller: new AbortController(),
      resolve: () => undefined,
      reject: () => undefined,
    };
    const promise = new Promise<ActionResult<T>>((resolve, reject) => {
      action.resolve = resolve;
      action.reject = reject;
    });
    if (definition.signal) {
      const cancel = () =>
        action.controller.abort(
          definition.signal?.reason ?? new ActionCancelledError(),
        );
      if (definition.signal.aborted) cancel();
      else {
        definition.signal.addEventListener("abort", cancel, { once: true });
        action.detachExternalSignal = () =>
          definition.signal?.removeEventListener("abort", cancel);
      }
    }
    this.queue.push(action);
    void this.pump();
    return promise;
  }

  cancel(actionId: string, reason?: string): boolean {
    const action = this.find(actionId);
    if (!action || action.controller.signal.aborted) return false;
    action.controller.abort(new ActionCancelledError(reason));
    return true;
  }

  cancelTask(taskId: string, reason?: string): number {
    const actions = [...this.queue, ...(this.active ? [this.active] : [])];
    let count = 0;
    for (const action of actions) {
      if (action.definition.taskId === taskId && this.cancel(action.id, reason))
        count += 1;
    }
    return count;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.paused = true;
    for (const action of [
      ...this.queue,
      ...(this.active ? [this.active] : []),
    ]) {
      if (!action.controller.signal.aborted)
        action.controller.abort(
          new ActionCancelledError("Runtime is stopping"),
        );
    }
    while (this.pumping || this.active || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  async pauseAndCancel(reason = "Runtime paused"): Promise<number> {
    this.paused = true;
    const actions = [...this.queue, ...(this.active ? [this.active] : [])];
    let cancelled = 0;
    for (const action of actions) {
      if (this.cancel(action.id, reason)) cancelled += 1;
    }
    await this.waitForIdle();
    return cancelled;
  }

  async cancelTaskAndWait(
    taskId: string,
    reason = "Task cancelled",
  ): Promise<number> {
    const cancelled = this.cancelTask(taskId, reason);
    while (
      this.active?.definition.taskId === taskId ||
      this.queue.some((action) => action.definition.taskId === taskId)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return cancelled;
  }

  async waitForIdle(): Promise<void> {
    while (this.active || this.queue.length > 0 || this.pumping) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  setPaused(paused: boolean): void {
    if (this.stopping && !paused)
      throw new Error("Cannot resume a stopping action coordinator");
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  halt(reason: string): void {
    if (this.safeHalted) return;
    this.safeHalted = true;
    this.safeHaltReason = redactText(reason).slice(0, 500);
    for (const action of [
      ...this.queue,
      ...(this.active ? [this.active] : []),
    ]) {
      if (!action.controller.signal.aborted) {
        action.controller.abort(new ActionCancelledError(this.safeHaltReason));
      }
    }
    try {
      this.options.onSafeHalt?.(this.safeHaltReason);
    } catch {
      // SAFE_HALT stays active even if its reporter fails.
    }
  }

  isSafeHalted(): boolean {
    return this.safeHalted;
  }

  clearSafeHalt(): boolean {
    if (this.active || this.queue.length > 0 || this.stopping) return false;
    this.safeHalted = false;
    this.safeHaltReason = null;
    return true;
  }

  getActive(): {
    actionId: string;
    taskId: string;
    owner: string;
    kind: string;
  } | null {
    if (!this.active) return null;
    return {
      actionId: this.active.id,
      taskId: this.active.definition.taskId,
      owner: this.active.definition.owner,
      kind: this.active.definition.kind,
    };
  }

  private find(id: string): QueuedAction | undefined {
    return this.active?.id === id
      ? this.active
      : this.queue.find((action) => action.id === id);
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.queue.length > 0) {
        const action = this.queue.shift()!;
        this.active = action;
        await this.run(action);
        this.active = null;
      }
    } finally {
      this.pumping = false;
    }
  }

  private async run<T>(action: QueuedAction<T>): Promise<void> {
    const definition = action.definition;
    const startedAt = new Date().toISOString();
    let timeout: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let cleanupReason: ActionCleanupReason = "failure";
    let successfulResult: T | undefined;
    let completed = false;
    let failure: unknown;
    let cleanupSucceeded = false;
    try {
      if (this.safeHalted)
        throw new ActionCancelledError(
          this.safeHaltReason ?? "Runtime is in SAFE_HALT",
        );
      if (action.controller.signal.aborted)
        throw abortReason(action.controller.signal);
      if (
        definition.deadlineAt &&
        Date.parse(definition.deadlineAt) <= Date.now()
      ) {
        throw new ActionTimeoutError(definition.kind);
      }
      const remainingDeadline = definition.deadlineAt
        ? Date.parse(definition.deadlineAt) - Date.now()
        : definition.timeoutMs;
      const timeoutMs = Math.min(definition.timeoutMs, remainingDeadline);
      const abortedPromise = new Promise<never>((_, reject) => {
        abortListener = () => reject(abortReason(action.controller.signal));
        action.controller.signal.addEventListener("abort", abortListener, {
          once: true,
        });
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          const error = new ActionTimeoutError(definition.kind);
          action.controller.abort(error);
          reject(error);
        }, timeoutMs);
      });
      if (
        !(await Promise.race([
          Promise.resolve().then(() => definition.precondition()),
          abortedPromise,
          timeoutPromise,
        ]))
      ) {
        throw new ActionPreconditionError(definition.kind);
      }
      action.controller.signal.throwIfAborted();
      const resultPromise = Promise.resolve().then(() =>
        definition.run(action.controller.signal),
      );
      const result = await Promise.race([
        resultPromise,
        abortedPromise,
        timeoutPromise,
      ]);
      if (
        !(await Promise.race([
          Promise.resolve().then(() => definition.verify(result)),
          abortedPromise,
          timeoutPromise,
        ]))
      ) {
        throw new ActionVerificationError(definition.kind);
      }
      action.controller.signal.throwIfAborted();
      cleanupReason = "success";
      successfulResult = result;
      completed = true;
    } catch (error) {
      cleanupReason = isTimeout(error, action.controller.signal)
        ? "timeout"
        : action.controller.signal.aborted
          ? "cancelled"
          : "failure";
      failure = error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener)
        action.controller.signal.removeEventListener("abort", abortListener);
      action.detachExternalSignal?.();
      try {
        await withTimeout(
          Promise.resolve(definition.cleanup?.(cleanupReason)),
          this.cleanupTimeoutMs,
          definition.kind,
        );
        cleanupSucceeded = true;
      } catch (error) {
        const reason = redactText(
          `Action cleanup failed (${definition.kind}): ${error instanceof Error ? error.message : "unknown error"}`,
        );
        this.halt(reason);
        if (completed) {
          completed = false;
          failure = error;
        }
      }
    }
    if (this.active === action) this.active = null;
    if (completed) {
      action.resolve({
        actionId: action.id,
        taskId: definition.taskId,
        kind: definition.kind,
        status: "succeeded",
        startedAt,
        finishedAt: new Date().toISOString(),
        result: successfulResult as T,
        verified: true,
      });
    } else {
      if (
        failure !== null &&
        (typeof failure === "object" || typeof failure === "function")
      ) {
        failureOutcomes.set(failure, {
          cleanup: cleanupSucceeded ? "completed" : "failed",
          actionLaneReleased: true,
        });
      }
      action.reject(
        failure ?? new Error(`Action did not complete: ${definition.kind}`),
      );
    }
  }
}

function isTimeout(error: unknown, signal: AbortSignal): boolean {
  return (
    error instanceof ActionTimeoutError ||
    signal.reason instanceof ActionTimeoutError
  );
}

function validateDefinition<T>(
  definition: ActionDefinition<T>,
  maxTimeoutMs: number,
): void {
  if (
    !definition.taskId.trim() ||
    !definition.owner.trim() ||
    !definition.kind.trim()
  ) {
    throw new Error("Action owner, task ID, and kind are required");
  }
  if (
    !Number.isInteger(definition.timeoutMs) ||
    definition.timeoutMs < 1 ||
    definition.timeoutMs > maxTimeoutMs
  ) {
    throw new RangeError(
      `Action timeout must be between 1 and ${maxTimeoutMs} milliseconds`,
    );
  }
  if (
    definition.deadlineAt &&
    !Number.isFinite(Date.parse(definition.deadlineAt))
  ) {
    throw new Error("Action deadline must be a valid date");
  }
  if (
    definition.resources.length === 0 ||
    new Set(definition.resources).size !== definition.resources.length
  ) {
    throw new Error("Actions require unique resource declarations");
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason instanceof Error
    ? signal.reason
    : new ActionCancelledError();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  kind: string,
): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Action cleanup timed out: ${kind}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
