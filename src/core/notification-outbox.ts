import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { redactText } from "./logger.js";

export interface OutboxNotification {
  id: string;
  payload: string;
  attempts: number;
}

export class NotificationOutbox {
  constructor(private readonly db: DatabaseSync) {}

  enqueue(
    dedupeKey: string,
    payload: string,
    ttlMs = 24 * 60 * 60_000,
  ): boolean {
    if (!dedupeKey.trim() || dedupeKey.length > 256)
      throw new Error("Notification dedupe key is invalid");
    if (
      !Number.isInteger(ttlMs) ||
      ttlMs < 1_000 ||
      ttlMs > 7 * 24 * 60 * 60_000
    ) {
      throw new RangeError(
        "Notification TTL must be between one second and seven days",
      );
    }
    const content = redactText(payload).slice(0, 1800);
    const now = Date.now();
    this.db
      .prepare("DELETE FROM notification_outbox WHERE expires_at <= ?")
      .run(now);
    const result = this.db
      .prepare(
        `INSERT INTO notification_outbox
      (id, dedupe_key, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(dedupe_key) DO NOTHING`,
      )
      .run(randomUUID(), dedupeKey, content, now, now + ttlMs);
    return result.changes > 0;
  }

  pending(limit = 50): OutboxNotification[] {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    this.db
      .prepare("DELETE FROM notification_outbox WHERE expires_at <= ?")
      .run(Date.now());
    const rows = this.db
      .prepare(
        `SELECT id, payload, attempts FROM notification_outbox
      WHERE sent_at IS NULL AND expires_at > ? ORDER BY created_at ASC LIMIT ?`,
      )
      .all(Date.now(), safeLimit) as unknown as OutboxNotification[];
    return rows;
  }

  markSent(id: string): void {
    this.db
      .prepare("UPDATE notification_outbox SET sent_at = ? WHERE id = ?")
      .run(Date.now(), id);
  }

  markAttempt(id: string): void {
    this.db
      .prepare(
        "UPDATE notification_outbox SET attempts = attempts + 1 WHERE id = ?",
      )
      .run(id);
  }
}
