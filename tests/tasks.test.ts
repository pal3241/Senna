import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SenaEventBus } from "../src/core/event-bus.js";
import { TaskRepository } from "../src/core/tasks/task-repository.js";
import { InvalidTaskTransitionError } from "../src/core/tasks/task.js";
import { Database } from "../src/storage/database.js";

const directories: string[] = [];
const createFileDatabase = () => {
  const directory = mkdtempSync(join(tmpdir(), "sena-tests-"));
  directories.push(directory);
  const db = new Database(join(directory, "sena.sqlite"));
  return {
    db,
    tasks: new TaskRepository(db.connection, new SenaEventBus()),
    directory,
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("persistent tasks", () => {
  it("stores checkpoints and marks in-flight work interrupted on restart", () => {
    const first = createFileDatabase();
    const task = first.tasks.create({
      source: "discord",
      ownerId: "owner-1",
      goal: "collect 4 oak logs",
      maxRetries: 2,
    });
    first.tasks.transition(task.id, "planning");
    first.tasks.transition(task.id, "ready");
    first.tasks.transition(task.id, "running");
    first.tasks.checkpoint(task.id, "collect", { collected: 2 });
    first.db.close();

    const reopened = new Database(join(first.directory, "sena.sqlite"));
    const tasks = new TaskRepository(reopened.connection, new SenaEventBus());
    expect(tasks.recoverActiveTasks()).toBe(1);
    const recovered = tasks.get(task.id);
    expect(recovered?.status).toBe("interrupted");
    expect(recovered?.checkpoint).toEqual({ collected: 2 });
    expect(recovered?.lastErrorCategory).toBe("process-restart");
    reopened.close();
  });

  it("rejects invalid state changes and bounds retries", () => {
    const { db, tasks } = createFileDatabase();
    const task = tasks.create({
      source: "system",
      goal: "inspect base",
      maxRetries: 1,
    });
    expect(() => tasks.transition(task.id, "succeeded")).toThrow(
      InvalidTaskTransitionError,
    );
    tasks.transition(task.id, "planning");
    tasks.transition(task.id, "ready");
    tasks.transition(task.id, "running");
    expect(tasks.failAttempt(task.id, "route-failed").status).toBe("queued");
    tasks.transition(task.id, "planning");
    tasks.transition(task.id, "ready");
    tasks.transition(task.id, "running");
    const failed = tasks.failAttempt(task.id, "route-failed");
    expect(failed.status).toBe("failed");
    expect(failed.retryCount).toBe(2);
    db.close();
  });

  it("redacts configured secrets from task goals and checkpoints", () => {
    vi.stubEnv("MINECRAFT_PASSWORD", "abc123");
    const { db, tasks } = createFileDatabase();
    const task = tasks.create({
      source: "discord",
      goal: "use password abc123",
    });
    expect(task.goal).not.toContain("abc123");
    const stored = tasks.checkpoint(task.id, "plan", { note: "abc123" });
    expect(JSON.stringify(stored.checkpoint)).not.toContain("abc123");
    db.close();
  });
});
