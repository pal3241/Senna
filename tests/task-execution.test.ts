import { afterEach, describe, expect, it, vi } from "vitest";
import type { MinecraftAdapter } from "../src/adapters/minecraft/minecraft-adapter.js";
import { SenaEventBus } from "../src/core/event-bus.js";
import { Database } from "../src/storage/database.js";
import { TaskRepository } from "../src/core/tasks/task-repository.js";
import {
  ActionCoordinator,
  ActionTimeoutError,
} from "../src/execution/action-coordinator.js";
import { GameplayActions } from "../src/execution/gameplay-actions.js";
import {
  parseMoveGoal,
  TaskExecutionService,
} from "../src/execution/task-execution-service.js";

const opened: Database[] = [];

function setup(
  options: {
    arrive?: boolean;
    waitForAbort?: boolean;
    moveError?: Error;
    failCleanup?: boolean;
  } = {},
) {
  const database = new Database(":memory:");
  opened.push(database);
  const events = new SenaEventBus();
  const tasks = new TaskRepository(database.connection, events);
  let position = { x: 0, y: 64, z: 0 };
  const stopMovement = vi.fn(() => {
    if (options.failCleanup) throw new Error("pathfinder-stop-failed");
  });
  const minecraft = {
    getWorldSnapshot: () => ({
      connection: "spawned",
      observedAt: new Date().toISOString(),
      position: {
        value: position,
        status: "known",
        source: "mineflayer",
        observedAt: new Date().toISOString(),
      },
    }),
    isMovementReady: () => true,
    moveTo: async (
      target: { x: number; y: number; z: number },
      signal: AbortSignal,
    ) => {
      if (options.moveError) throw options.moveError;
      if (options.waitForAbort) {
        await new Promise<void>((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      }
      signal.throwIfAborted();
      if (options.arrive !== false) position = target;
    },
    stopMovement,
  } as unknown as MinecraftAdapter;
  const coordinator = new ActionCoordinator();
  const gameplay = new GameplayActions(coordinator, minecraft);
  const execution = new TaskExecutionService(
    tasks,
    minecraft,
    gameplay,
    events,
  );
  return {
    database,
    events,
    tasks,
    minecraft,
    coordinator,
    execution,
    stopMovement,
  };
}

afterEach(() => {
  for (const database of opened.splice(0)) database.close();
});

describe("verified task-to-gameplay execution", () => {
  it("executes a bounded explicit move and atomically persists verified completion", async () => {
    const rig = setup();
    const task = rig.tasks.create({
      source: "system",
      goal: "move_to 4 64 0",
      maxRetries: 0,
    });
    const completed = await rig.execution.execute(task.id);
    expect(completed.status).toBe("succeeded");
    expect(completed.checkpoint).toMatchObject({
      capability: "minecraft.move_to",
      target: { x: 4, y: 64, z: 0 },
    });
    expect(completed.verification).toMatchObject({
      status: "known",
      criterion: "within-1.75-blocks",
      distance: 0,
    });
  });

  it("blocks unsupported, unsafe, distant, or disconnected goals without moving", async () => {
    const unsupported = setup();
    const unsupportedTask = unsupported.tasks.create({
      source: "system",
      goal: "go explore",
    });
    expect(
      (await unsupported.execution.execute(unsupportedTask.id))
        .lastErrorCategory,
    ).toBe("unsupported-goal");

    const disconnected = setup();
    const minecraft = disconnected.minecraft as unknown as {
      getWorldSnapshot: () => { connection: string; position: unknown };
    };
    minecraft.getWorldSnapshot = () => ({
      connection: "disconnected",
      position: null,
    });
    const disconnectedTask = disconnected.tasks.create({
      source: "system",
      goal: "move_to 2 64 0",
    });
    expect(
      (await disconnected.execution.execute(disconnectedTask.id))
        .lastErrorCategory,
    ).toBe("minecraft-disconnected");

    expect(parseMoveGoal("move_to 90000000 64 0")).toBeNull();
    expect(parseMoveGoal("move_to NaN 64 0")).toBeNull();
  });

  it("never marks an unverified path as success and cleans up movement", async () => {
    const rig = setup({ arrive: false });
    const task = rig.tasks.create({ source: "system", goal: "move_to 4 64 0" });
    const blocked = await rig.execution.execute(task.id);
    expect(blocked.status).toBe("blocked");
    expect(blocked.lastErrorCategory).toBe("postcondition-unverified");
    expect(rig.stopMovement).toHaveBeenCalledOnce();
    expect(rig.tasks.eventsFor(task.id)[0]?.detail).toMatchObject({
      actionStopped: "confirmed",
      resourceReleased: "confirmed",
      coordinatorLaneReleased: true,
    });
  });

  it("maps adapter errors and timeouts to blocked persisted outcomes with cleanup evidence", async () => {
    const adapterFailure = setup({
      moveError: new Error("pathfinder-rejected"),
    });
    const failedTask = adapterFailure.tasks.create({
      source: "system",
      goal: "move_to 4 64 0",
    });
    const blocked = await adapterFailure.execution.execute(failedTask.id);
    expect(blocked.status).toBe("blocked");
    expect(blocked.lastErrorCategory).toBe("action-failed");
    expect(
      adapterFailure.tasks.eventsFor(failedTask.id)[0]?.detail,
    ).toMatchObject({
      actionStopped: "confirmed",
      resourceReleased: "confirmed",
      coordinatorLaneReleased: true,
    });

    const timedOut = setup({
      moveError: new ActionTimeoutError("minecraft.move_to"),
    });
    const timedOutTask = timedOut.tasks.create({
      source: "system",
      goal: "move_to 4 64 0",
    });
    const timedOutResult = await timedOut.execution.execute(timedOutTask.id);
    expect(timedOutResult.status).toBe("blocked");
    expect(timedOutResult.lastErrorCategory).toBe("action-timeout");
  });

  it("does not claim movement stopped if cleanup fails", async () => {
    const rig = setup({
      moveError: new Error("pathfinder-rejected"),
      failCleanup: true,
    });
    const task = rig.tasks.create({ source: "system", goal: "move_to 4 64 0" });
    const blocked = await rig.execution.execute(task.id);
    expect(blocked.status).toBe("blocked");
    expect(rig.coordinator.isSafeHalted()).toBe(true);
    expect(rig.tasks.eventsFor(task.id)[0]?.detail).toMatchObject({
      actionStopped: "unknown",
      resourceReleased: "failed",
      coordinatorLaneReleased: true,
    });
  });

  it("stops and blocks an in-flight movement when Minecraft disconnects", async () => {
    const rig = setup({ waitForAbort: true });
    const task = rig.tasks.create({ source: "system", goal: "move_to 4 64 0" });
    const execution = rig.execution.execute(task.id);
    await vi.waitFor(() =>
      expect(rig.coordinator.getActive()?.kind).toBe("minecraft.move_to"),
    );
    rig.events.emit("runtime.connection", {
      adapter: "minecraft",
      status: "disconnected",
    });
    const blocked = await execution;
    expect(blocked.status).toBe("blocked");
    expect(blocked.lastErrorCategory).toBe("minecraft-disconnected");
    expect(rig.stopMovement).toHaveBeenCalledOnce();
  });

  it("cancels task work only after action cleanup and never replays interrupted tasks", async () => {
    const rig = setup({ waitForAbort: true });
    const task = rig.tasks.create({ source: "system", goal: "move_to 4 64 0" });
    const running = rig.execution.execute(task.id);
    await vi.waitFor(() => expect(rig.coordinator.getActive()).not.toBeNull());
    const cancelled = await rig.execution.cancel(task.id);
    expect(cancelled.status).toBe("cancelled");
    expect(rig.stopMovement).toHaveBeenCalledOnce();

    const interrupted = rig.tasks.create({
      source: "system",
      goal: "move_to 2 64 0",
    });
    rig.tasks.transition(interrupted.id, "planning");
    rig.tasks.transition(interrupted.id, "ready");
    rig.tasks.transition(interrupted.id, "running");
    rig.tasks.recoverActiveTasks();
    expect((await rig.execution.execute(interrupted.id)).status).toBe(
      "interrupted",
    );
    await running;
  });
});
