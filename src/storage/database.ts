import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const schemaVersion = 2;

export class Database {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.connection = new DatabaseSync(path, { timeout: 1000 });
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;",
    );
    this.migrate();
  }

  close(): void {
    if (this.connection.isOpen) this.connection.close();
  }

  private migrate(): void {
    const current = this.connection.prepare("PRAGMA user_version").get() as
      { user_version: number } | undefined;
    let version = current?.user_version ?? 0;
    if (version > schemaVersion) {
      throw new Error(
        `Database schema ${version} is newer than this Sena build supports`,
      );
    }
    if (version === 0) {
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        this.connection.exec(`
          CREATE TABLE tasks (
            id TEXT PRIMARY KEY,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            source TEXT NOT NULL,
            owner_id TEXT,
            goal TEXT NOT NULL,
            priority INTEGER NOT NULL,
            status TEXT NOT NULL,
            deadline_at TEXT,
            retry_count INTEGER NOT NULL,
            max_retries INTEGER NOT NULL,
            phase TEXT,
            checkpoint_json TEXT NOT NULL,
            capabilities_json TEXT NOT NULL,
            expected_result TEXT,
            verification_json TEXT,
            last_error_category TEXT,
            cancel_requested INTEGER NOT NULL DEFAULT 0
          );
          CREATE INDEX tasks_status_priority_created ON tasks(status, priority DESC, created_at ASC);
          CREATE TABLE task_events (
            sequence INTEGER PRIMARY KEY AUTOINCREMENT,
            task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
            at TEXT NOT NULL,
            from_status TEXT,
            to_status TEXT NOT NULL,
            event_type TEXT NOT NULL,
            detail_json TEXT NOT NULL
          );
          CREATE INDEX task_events_task_sequence ON task_events(task_id, sequence);
          CREATE TABLE runtime_state (
            key TEXT PRIMARY KEY,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL
          );
          PRAGMA user_version = 1;
        `);
        this.connection.exec("COMMIT");
        version = 1;
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    }
    if (version === 1) {
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        this.connection.exec(`
          CREATE TABLE notification_outbox (
            id TEXT PRIMARY KEY,
            dedupe_key TEXT NOT NULL UNIQUE,
            payload TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            sent_at INTEGER
          );
          CREATE INDEX notification_outbox_pending ON notification_outbox(sent_at, expires_at);
          PRAGMA user_version = 2;
        `);
        this.connection.exec("COMMIT");
      } catch (error) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    }
  }
}
