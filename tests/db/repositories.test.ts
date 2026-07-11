import { describe, expect, it, vi } from "vitest";
import { createRepositories } from "../../src/db/repositories";
import { processDueReminders } from "../../src/reminders/processor";

type QueryResult<T> = {
  results?: T[];
  success: boolean;
};

class FakeStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string,
  ) {}

  bind(...params: unknown[]): FakeStatement {
    this.params = params;
    return this;
  }

  async all<T>(): Promise<QueryResult<T>> {
    this.db.record(this.sql, this.params);
    return {
      results: this.db.select<T>(this.sql, this.params),
      success: true,
    };
  }

  async first<T>(): Promise<T | null> {
    this.db.record(this.sql, this.params);
    return this.db.select<T>(this.sql, this.params)[0] ?? null;
  }

  async run(): Promise<D1Result> {
    this.db.record(this.sql, this.params);
    return this.db.update(this.sql, this.params);
  }
}

type UserRow = {
  id: string;
  display_name: string | null;
  timezone: string;
};

type ReminderRow = {
  id: string;
  user_id: string;
  message: string;
  due_at_utc: string;
  status: "scheduled" | "processing" | "completed" | "sent" | "cancelled";
  timezone: string;
  updated_at?: string;
};

type MemoryRow = {
  id: string;
  user_id: string;
  content: string;
};

class FakeD1Database {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  users: UserRow[] = [];
  reminders: ReminderRow[] = [];
  memories: MemoryRow[] = [];

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this, sql);
  }

  record(sql: string, params: unknown[]): void {
    this.queries.push({ sql, params });
  }

  select<T>(sql: string, params: unknown[]): T[] {
    const normalized = normalizeSql(sql);

    if (normalized.includes("from reminders")) {
      if (normalized.includes("due_at_utc <= ?") && normalized.includes("status = ?")) {
        const [nowUtc, status, staleBeforeUtc, limit] = params as [
          string,
          ReminderRow["status"],
          string,
          number,
        ];
        return this.reminders
          .filter(
            (row) =>
              row.due_at_utc <= nowUtc &&
              (row.status === status ||
                (row.status === "processing" && (row.updated_at ?? "") <= staleBeforeUtc)),
          )
          .sort((a, b) => a.due_at_utc.localeCompare(b.due_at_utc))
          .slice(0, limit) as T[];
      }

      const [userId, status] = params as [string, ReminderRow["status"]];
      return this.reminders.filter(
        (row) => row.user_id === userId && row.status === status,
      ) as T[];
    }

    if (normalized.includes("from users")) {
      const [userId] = params as [string];
      return this.users.filter((row) => row.id === userId) as T[];
    }

    if (normalized.includes("from memories")) {
      const [userId, term, limit] = params as [string, string, number];
      return this.memories
        .filter((row) => row.user_id === userId && row.content.includes(term.replaceAll("%", "")))
        .slice(0, limit) as T[];
    }

    return [];
  }

  update(sql: string, params: unknown[]): D1Result {
    const normalized = normalizeSql(sql);

    if (normalized.startsWith("update users")) {
      const [timezone, updatedAt, userId] = params as [string, string, string];
      let changes = 0;
      this.users = this.users.map((row) => {
        if (row.id !== userId) {
          return row;
        }
        changes += 1;
        return { ...row, timezone };
      });
      return makeD1Result(changes);
    }

    if (normalized.startsWith("delete from users")) {
      const [userId] = params as [string];
      const before = this.users.length;
      this.users = this.users.filter((row) => row.id !== userId);
      return makeD1Result(before - this.users.length);
    }

    if (normalized.startsWith("update reminders")) {
      const [status, value] = params as [ReminderRow["status"], string];
      let changes = 0;

      if (
        normalized.includes("or (status = ? and updated_at <= ?)") &&
        params.length === 6
      ) {
        const [, , reminderId, scheduledStatus, processingStatus, staleBeforeUtc] =
          params as [
            ReminderRow["status"],
            string,
            string,
            ReminderRow["status"],
            ReminderRow["status"],
            string,
          ];
        this.reminders = this.reminders.map((row) => {
          const canClaim =
            row.id === reminderId &&
            (row.status === scheduledStatus ||
              (row.status === processingStatus && (row.updated_at ?? "") <= staleBeforeUtc));
          if (!canClaim) {
            return row;
          }
          changes += 1;
          return { ...row, status, updated_at: value };
        }) as ReminderRow[];

        return makeD1Result(changes);
      }

      const [reminderId, currentStatus] =
        params.length === 4
          ? (params.slice(2) as [string, ReminderRow["status"]])
          : ([params[3], params[4]] as [string, ReminderRow["status"]]);
      this.reminders = this.reminders.map((row) => {
        if (row.id !== reminderId || row.status !== currentStatus) {
          return row;
        }
        changes += 1;
        return {
          ...row,
          status,
          updated_at: value,
          sent_at_utc: status === "sent" ? value : null,
        };
      }) as ReminderRow[];

      return makeD1Result(changes);
    }

    return makeD1Result(0);
  }
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

function makeD1Result(changes: number): D1Result {
  return {
    success: true,
    meta: {
      changed_db: true,
      changes,
      duration: 0,
      last_row_id: 0,
      rows_read: 0,
      rows_written: changes,
      size_after: 0,
    },
  } as D1Result;
}

describe("D1 repositories", () => {
  it("lists only scheduled reminders for the requested user", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "due-a",
        user_id: "user-a",
        message: "stand up",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "scheduled",
        timezone: "Asia/Taipei",
      },
      {
        id: "sent-a",
        user_id: "user-a",
        message: "already pushed",
        due_at_utc: "2026-07-10T08:00:00.000Z",
        status: "sent",
        timezone: "Asia/Taipei",
      },
      {
        id: "due-b",
        user_id: "user-b",
        message: "other user's reminder",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "scheduled",
        timezone: "Asia/Taipei",
      },
    ];

    const repos = createRepositories(db as unknown as D1Database);
    const reminders = await repos.reminders.listScheduledForUser("user-a", 10);

    expect(reminders.map((reminder) => reminder.id)).toEqual(["due-a"]);
    expect(db.queries.at(-1)).toMatchObject({
      params: ["user-a", "scheduled", 10],
    });
    expect(normalizeSql(db.queries.at(-1)?.sql ?? "")).toContain("user_id = ?");
  });

  it("finds due unsent reminders and excludes completed or already pushed reminders", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "due-unsent",
        user_id: "user-a",
        message: "send this",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "scheduled",
        timezone: "Asia/Taipei",
      },
      {
        id: "future",
        user_id: "user-a",
        message: "not yet",
        due_at_utc: "2026-07-10T11:00:00.000Z",
        status: "scheduled",
        timezone: "Asia/Taipei",
      },
      {
        id: "stale-processing",
        user_id: "user-a",
        message: "retry stale claim",
        due_at_utc: "2026-07-10T08:30:00.000Z",
        status: "processing",
        timezone: "Asia/Taipei",
        updated_at: "2026-07-10T08:40:00.000Z",
      },
      {
        id: "already-sent",
        user_id: "user-a",
        message: "skip this",
        due_at_utc: "2026-07-10T08:00:00.000Z",
        status: "sent",
        timezone: "Asia/Taipei",
      },
      {
        id: "completed",
        user_id: "user-a",
        message: "completed",
        due_at_utc: "2026-07-10T07:00:00.000Z",
        status: "completed",
        timezone: "Asia/Taipei",
      },
    ];

    const repos = createRepositories(db as unknown as D1Database);
    const reminders = await repos.reminders.findDueUnsent(
      "2026-07-10T10:00:00.000Z",
      5,
    );

    expect(reminders.map((reminder) => reminder.id)).toEqual([
      "stale-processing",
      "due-unsent",
    ]);
    expect(db.queries.at(-1)).toMatchObject({
      params: [
        "2026-07-10T10:00:00.000Z",
        "scheduled",
        "2026-07-10T09:55:00.000Z",
        5,
      ],
    });
  });

  it("finds stale processing reminders as retryable", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "stale-processing",
        user_id: "user-a",
        message: "retry",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "processing",
        timezone: "Asia/Taipei",
      },
    ];

    const repos = createRepositories(db as unknown as D1Database);
    const reminders = await repos.reminders.findDueUnsent(
      "2026-07-10T10:00:00.000Z",
      5,
    );

    expect(reminders.map((reminder) => reminder.id)).toEqual(["stale-processing"]);
  });

  it("claims a reminder only while it is still unsent", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "due-unsent",
        user_id: "user-a",
        message: "send this",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "scheduled",
        timezone: "Asia/Taipei",
      },
      {
        id: "already-sent",
        user_id: "user-a",
        message: "skip this",
        due_at_utc: "2026-07-10T08:00:00.000Z",
        status: "sent",
        timezone: "Asia/Taipei",
      },
    ];

    const repos = createRepositories(db as unknown as D1Database);

    await expect(
      repos.reminders.claimDueReminder("due-unsent", "2026-07-10T10:00:00.000Z"),
    ).resolves.toBe(true);
    await expect(
      repos.reminders.claimDueReminder("already-sent", "2026-07-10T10:00:00.000Z"),
    ).resolves.toBe(false);

    expect(db.queries.at(-1)).toMatchObject({
      params: [
        "processing",
        "2026-07-10T10:00:00.000Z",
        "already-sent",
        "scheduled",
        "processing",
        "2026-07-10T09:55:00.000Z",
      ],
    });
    expect(normalizeSql(db.queries.at(-1)?.sql ?? "")).toContain("status = ?");
  });

  it("claims stale processing reminders so abandoned leases can retry", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "stale-processing",
        user_id: "user-a",
        message: "retry this",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "processing",
        timezone: "Asia/Taipei",
        updated_at: "2026-07-10T09:54:59.000Z",
      },
      {
        id: "fresh-processing",
        user_id: "user-a",
        message: "do not steal this",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "processing",
        timezone: "Asia/Taipei",
        updated_at: "2026-07-10T09:59:00.000Z",
      },
    ];

    const repos = createRepositories(db as unknown as D1Database);

    await expect(
      repos.reminders.claimDueReminder(
        "stale-processing",
        "2026-07-10T10:00:00.000Z",
      ),
    ).resolves.toBe(true);
    await expect(
      repos.reminders.claimDueReminder(
        "fresh-processing",
        "2026-07-10T10:00:00.000Z",
      ),
    ).resolves.toBe(false);

    expect(db.reminders.find((row) => row.id === "stale-processing")?.updated_at).toBe(
      "2026-07-10T10:00:00.000Z",
    );
    expect(db.queries.at(-1)).toMatchObject({
      params: [
        "processing",
        "2026-07-10T10:00:00.000Z",
        "fresh-processing",
        "scheduled",
        "processing",
        "2026-07-10T09:55:00.000Z",
      ],
    });
  });

  it("pushes and marks a stale processing reminder through the processor", async () => {
    const db = new FakeD1Database();
    db.reminders = [
      {
        id: "stale-processing",
        user_id: "user-a",
        message: "retry this",
        due_at_utc: "2026-07-10T09:00:00.000Z",
        status: "processing",
        timezone: "Asia/Taipei",
        updated_at: "2026-07-10T09:54:59.000Z",
      },
    ];
    const repos = createRepositories(db as unknown as D1Database);
    const line = {
      push: vi.fn<(userId: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
    };

    const summary = await processDueReminders("2026-07-10T10:00:00.000Z", {
      reminders: repos.reminders,
      line,
      batchSize: 10,
    });

    expect(summary).toEqual({ attempted: 1, pushed: 1, skipped: 0, failed: 0 });
    expect(line.push).toHaveBeenCalledWith("user-a", "retry this");
    expect(db.reminders.find((row) => row.id === "stale-processing")).toMatchObject({
      status: "sent",
      updated_at: "2026-07-10T10:00:00.000Z",
      sent_at_utc: "2026-07-10T10:00:00.000Z",
    });
  });

  it("persists user timezone and finds it by user id", async () => {
    const db = new FakeD1Database();
    db.users = [{ id: "user-a", display_name: null, timezone: "Asia/Taipei" }];
    const repos = createRepositories(db as unknown as D1Database);

    await repos.users.updateTimezone("user-a", "America/New_York", "2026-07-10T10:00:00.000Z");
    const user = await repos.users.findById("user-a");

    expect(user?.timezone).toBe("America/New_York");
    expect(db.queries.at(-2)).toMatchObject({
      params: ["America/New_York", "2026-07-10T10:00:00.000Z", "user-a"],
    });
  });

  it("does not return another user's memories", async () => {
    const db = new FakeD1Database();
    db.memories = [
      { id: "memory-a", user_id: "user-a", content: "likes dorayaki" },
      { id: "memory-b", user_id: "user-b", content: "likes dorayaki" },
    ];

    const repos = createRepositories(db as unknown as D1Database);
    const memories = await repos.memories.search("user-a", "dorayaki", 10);

    expect(memories.map((memory) => memory.id)).toEqual(["memory-a"]);
    expect(db.queries.at(-1)).toMatchObject({
      params: ["user-a", "%dorayaki%", 10],
    });
    expect(normalizeSql(db.queries.at(-1)?.sql ?? "")).toContain("user_id = ?");
  });
});
