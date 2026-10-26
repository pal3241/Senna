import type { DatabaseSync } from "node:sqlite";

export interface RuntimeControlSnapshot {
  paused: boolean;
  safeHaltReason: string | null;
}

export class RuntimeControls {
  constructor(private readonly db: DatabaseSync) {}

  get(): RuntimeControlSnapshot {
    return {
      paused: this.read<boolean>("paused") ?? false,
      safeHaltReason: this.read<string>("safe-halt-reason") ?? null,
    };
  }

  setPaused(paused: boolean): RuntimeControlSnapshot {
    this.write("paused", paused);
    return this.get();
  }

  setSafeHalt(reason: string | null): RuntimeControlSnapshot {
    this.write("safe-halt-reason", reason);
    return this.get();
  }

  private read<T>(key: string): T | null {
    const row = this.db
      .prepare("SELECT value_json FROM runtime_state WHERE key = ?")
      .get(key) as { value_json: string } | undefined;
    return row ? (JSON.parse(row.value_json) as T) : null;
  }

  private write(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO runtime_state (key, value_json, updated_at)
        VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json,
        updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), new Date().toISOString());
  }
}
