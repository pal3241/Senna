import { afterEach, describe, expect, it, vi } from "vitest";
import { Database } from "../src/storage/database.js";
import { NotificationOutbox } from "../src/core/notification-outbox.js";

describe("Discord notification outbox", () => {
  afterEach(() => vi.useRealTimers());

  it("deduplicates, tracks delivery attempts, and removes sent notifications", () => {
    const database = new Database(":memory:");
    const outbox = new NotificationOutbox(database.connection);
    expect(outbox.enqueue("task:1:failed", "Task failed")).toBe(true);
    expect(outbox.enqueue("task:1:failed", "Duplicate alert")).toBe(false);
    const [notification] = outbox.pending();
    expect(notification?.payload).toBe("Task failed");
    outbox.markAttempt(notification!.id);
    expect(outbox.pending()[0]?.attempts).toBe(1);
    outbox.markSent(notification!.id);
    expect(outbox.pending()).toEqual([]);
    database.close();
  });

  it("expires stale alerts and redacts configured credentials", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-26T00:00:00.000Z"));
    vi.stubEnv("DISCORD_BOT_TOKEN", "test-secret");
    const database = new Database(":memory:");
    const outbox = new NotificationOutbox(database.connection);
    outbox.enqueue("alert", "Token test-secret failed", 1000);
    expect(outbox.pending()[0]?.payload).toBe("Token [REDACTED] failed");
    vi.advanceTimersByTime(1001);
    expect(outbox.pending()).toEqual([]);
    expect(outbox.enqueue("alert", "Recovered alert", 1000)).toBe(true);
    database.close();
    vi.unstubAllEnvs();
  });
});
