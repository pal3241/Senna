import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionCancelledError,
  ActionCoordinator,
  ActionPreconditionError,
  ActionTimeoutError,
  ActionVerificationError,
  type ActionDefinition,
} from "../src/execution/action-coordinator.js";

function action<T>(
  overrides: Partial<ActionDefinition<T>> = {},
): ActionDefinition<T> {
  return {
    taskId: "task-1",
    owner: "core",
    kind: "test-action",
    resources: ["movement"],
    timeoutMs: 1000,
    precondition: () => true,
    run: () => 1 as T,
    verify: () => true,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("action coordinator", () => {
  it("serializes conflicting gameplay control through one action lane", async () => {
    const coordinator = new ActionCoordinator();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const first = coordinator.execute(
      action({
        kind: "first",
        run: async () => {
          order.push("first-start");
          await new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          order.push("first-end");
          return "first";
        },
        verify: (value) => value === "first",
      }),
    );
    while (!releaseFirst) await Promise.resolve();
    const second = coordinator.execute(
      action({
        kind: "second",
        run: () => {
          order.push("second-start");
          return "second";
        },
        verify: (value) => value === "second",
      }),
    );
    await Promise.resolve();
    expect(order).toEqual(["first-start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });

  it("cancels active work and completes cleanup before rejecting", async () => {
    const coordinator = new ActionCoordinator();
    let cleanupComplete = false;
    const pending = coordinator.execute(
      action({
        run: () => new Promise<number>(() => undefined),
        cleanup: () => {
          cleanupComplete = true;
        },
      }),
    );
    while (!coordinator.getActive()) await Promise.resolve();
    const active = coordinator.getActive();
    expect(active).not.toBeNull();
    coordinator.cancel(active!.actionId, "requested by test");
    await expect(pending).rejects.toBeInstanceOf(ActionCancelledError);
    expect(cleanupComplete).toBe(true);
  });

  it("never reports success when preconditions or verification fail", async () => {
    const coordinator = new ActionCoordinator();
    let didRun = false;
    await expect(
      coordinator.execute(
        action({
          precondition: () => false,
          run: () => {
            didRun = true;
            return 1;
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ActionPreconditionError);
    expect(didRun).toBe(false);
    await expect(
      coordinator.execute(action({ verify: () => false })),
    ).rejects.toBeInstanceOf(ActionVerificationError);
  });

  it("uses bounded action deadlines", async () => {
    vi.useFakeTimers();
    const coordinator = new ActionCoordinator();
    const pending = coordinator.execute(
      action({
        timeoutMs: 20,
        run: () => new Promise<number>(() => undefined),
      }),
    );
    const rejection =
      expect(pending).rejects.toBeInstanceOf(ActionTimeoutError);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(21);
    await rejection;
  });

  it("halts if plugin cleanup fails and refuses to report success", async () => {
    const reasons: string[] = [];
    const coordinator = new ActionCoordinator({
      onSafeHalt: (reason) => reasons.push(reason),
    });
    const first = coordinator.execute(
      action({
        cleanup: () => {
          throw new Error("pathfinder failed to stop");
        },
      }),
    );
    let secondRan = false;
    const second = coordinator.execute(
      action({
        run: () => {
          secondRan = true;
          return 2;
        },
      }),
    );
    await expect(first).rejects.toThrow("pathfinder failed to stop");
    await expect(second).rejects.toBeInstanceOf(ActionCancelledError);
    expect(reasons[0]).toContain("Action cleanup failed");
    expect(secondRan).toBe(false);
    expect(coordinator.isSafeHalted()).toBe(true);
  });
});
