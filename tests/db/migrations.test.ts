import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const hasSqlite = spawnSync("sqlite3", ["-version"]).status === 0;

describe("D1 migrations", () => {
  it("upgrades an existing 0001 database without losing reminder data", () => {
    expect(hasSqlite, "sqlite3 is required to verify migration upgrade safety").toBe(true);

    const directory = mkdtempSync(join(tmpdir(), "line-bot-migrations-"));
    const dbPath = join(directory, "test.sqlite");

    try {
      runSql(dbPath, readMigration("0001_initial.sql"));
      runSql(
        dbPath,
        `
          INSERT INTO users (id, display_name, created_at, updated_at)
          VALUES ('user-a', 'A', '2026-07-10T08:00:00.000Z', '2026-07-10T08:00:00.000Z');

          INSERT INTO reminders (
            id,
            user_id,
            message,
            due_at_utc,
            status,
            created_at,
            updated_at,
            sent_at_utc,
            cancelled_at_utc
          )
          VALUES (
            'reminder-a',
            'user-a',
            'legacy reminder',
            '2026-07-10T09:00:00.000Z',
            'scheduled',
            '2026-07-10T08:00:00.000Z',
            '2026-07-10T08:30:00.000Z',
            NULL,
            NULL
          );
        `,
      );

      runSql(dbPath, readMigration("0002_timezone_and_processing.sql"));

      expect(queryRows(dbPath, "SELECT name FROM pragma_table_info('users')")).toContain(
        "timezone",
      );
      expect(queryRows(dbPath, "SELECT name FROM pragma_table_info('reminders')")).toContain(
        "timezone",
      );
      expect(queryRows(dbPath, "SELECT timezone FROM users WHERE id = 'user-a'")).toEqual([
        "Asia/Taipei",
      ]);
      expect(
        queryRows(
          dbPath,
          "SELECT message || '|' || timezone || '|' || status FROM reminders WHERE id = 'reminder-a'",
        ),
      ).toEqual(["legacy reminder|Asia/Taipei|scheduled"]);

      runSql(
        dbPath,
        `
          INSERT INTO reminders (
            id,
            user_id,
            message,
            due_at_utc,
            timezone,
            status
          )
          VALUES (
            'processing-reminder',
            'user-a',
            'retry lease',
            '2026-07-10T09:00:00.000Z',
            'Asia/Taipei',
            'processing'
          );
        `,
      );

      expect(
        queryRows(
          dbPath,
          `
            SELECT name
            FROM sqlite_master
            WHERE type = 'index'
              AND tbl_name = 'reminders'
              AND name NOT LIKE 'sqlite_autoindex_%'
            ORDER BY name
          `,
        ),
      ).toEqual(["idx_reminders_status_due_at_utc", "idx_reminders_user_status"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

function readMigration(filename: string): string {
  return readFileSync(join("src", "db", "migrations", filename), "utf8");
}

function runSql(dbPath: string, sql: string): void {
  execFileSync("sqlite3", [dbPath], { input: sql });
}

function queryRows(dbPath: string, sql: string): string[] {
  const output = execFileSync("sqlite3", ["-batch", "-noheader", dbPath, sql], {
    encoding: "utf8",
  });
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}
