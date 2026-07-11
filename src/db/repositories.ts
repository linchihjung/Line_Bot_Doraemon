export type TodoStatus = "open" | "completed";
export type ReminderStatus = "scheduled" | "processing" | "completed" | "sent" | "cancelled";
export type ConversationRole = "user" | "assistant" | "system";
const PROCESSING_LEASE_MS = 5 * 60 * 1000;

export interface UserRecord {
  id: string;
  display_name: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

export interface TodoRecord {
  id: string;
  user_id: string;
  title: string;
  status: TodoStatus;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface ReminderRecord {
  id: string;
  user_id: string;
  message: string;
  due_at_utc: string;
  timezone: string;
  status: ReminderStatus;
  created_at: string;
  updated_at: string;
  sent_at_utc: string | null;
  cancelled_at_utc: string | null;
}

export interface MemoryRecord {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessageRecord {
  id: string;
  user_id: string;
  role: ConversationRole;
  content: string;
  created_at: string;
}

export interface UserRepository {
  upsert(userId: string, displayName?: string | null): Promise<void>;
  findById(userId: string): Promise<UserRecord | null>;
  updateTimezone(userId: string, timezone: string, nowUtc: string): Promise<boolean>;
  deleteAllUserData(userId: string): Promise<boolean>;
}

export interface TodoRepository {
  create(input: {
    id: string;
    userId: string;
    title: string;
    nowUtc: string;
  }): Promise<void>;
  listOpenForUser(userId: string, limit: number): Promise<TodoRecord[]>;
  complete(userId: string, todoId: string, nowUtc: string): Promise<boolean>;
}

export interface ReminderRepository {
  create(input: {
    id: string;
    userId: string;
    message: string;
    dueAtUtc: string;
    timezone?: string;
    nowUtc: string;
  }): Promise<void>;
  listScheduledForUser(userId: string, limit: number): Promise<ReminderRecord[]>;
  cancel(userId: string, reminderId: string, nowUtc: string): Promise<boolean>;
  findDueUnsent(nowUtc: string, limit: number): Promise<ReminderRecord[]>;
  claimDueReminder(reminderId: string, sentAtUtc: string): Promise<boolean>;
  markReminderSent(reminderId: string, sentAtUtc: string): Promise<boolean>;
  releaseDueReminder(reminderId: string, nowUtc: string): Promise<boolean>;
}

export interface MemoryRepository {
  create(input: {
    id: string;
    userId: string;
    content: string;
    nowUtc: string;
  }): Promise<void>;
  search(userId: string, term: string, limit: number): Promise<MemoryRecord[]>;
  listRecent(userId: string, limit: number): Promise<MemoryRecord[]>;
  delete(userId: string, memoryId: string): Promise<boolean>;
}

export interface ConversationRepository {
  addMessage(input: {
    id: string;
    userId: string;
    role: ConversationRole;
    content: string;
    createdAtUtc: string;
  }): Promise<void>;
  listRecent(userId: string, limit: number): Promise<ConversationMessageRecord[]>;
  clearRecent(userId: string): Promise<void>;
  pruneRecent(userId: string, keep: number): Promise<void>;
}

export interface ProcessedEventRepository {
  recordIfNew(eventId: string): Promise<boolean>;
  hasProcessed(eventId: string): Promise<boolean>;
}

export interface Repositories {
  users: UserRepository;
  todos: TodoRepository;
  reminders: ReminderRepository;
  memories: MemoryRepository;
  conversations: ConversationRepository;
  processedEvents: ProcessedEventRepository;
}

export function createRepositories(db: D1Database): Repositories {
  return {
    users: createUserRepository(db),
    todos: createTodoRepository(db),
    reminders: createReminderRepository(db),
    memories: createMemoryRepository(db),
    conversations: createConversationRepository(db),
    processedEvents: createProcessedEventRepository(db),
  };
}

function createUserRepository(db: D1Database): UserRepository {
  return {
    async upsert(userId, displayName = null) {
      await db
        .prepare(
          `
            INSERT INTO users (id, display_name, timezone)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              display_name = excluded.display_name,
              updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          `,
        )
        .bind(userId, displayName, "Asia/Taipei")
        .run();
    },

    async findById(userId) {
      return db
        .prepare(
          `
            SELECT id, display_name, timezone, created_at, updated_at
            FROM users
            WHERE id = ?
          `,
        )
        .bind(userId)
        .first<UserRecord>();
    },

    async updateTimezone(userId, timezone, nowUtc) {
      const result = await db
        .prepare(
          `
            UPDATE users
            SET timezone = ?, updated_at = ?
            WHERE id = ?
          `,
        )
        .bind(timezone, nowUtc, userId)
        .run();
      return changed(result);
    },

    async deleteAllUserData(userId) {
      const result = await db
        .prepare(
          `
            DELETE FROM users
            WHERE id = ?
          `,
        )
        .bind(userId)
        .run();
      return changed(result);
    },
  };
}

function createTodoRepository(db: D1Database): TodoRepository {
  return {
    async create(input) {
      await db
        .prepare(
          `
            INSERT INTO todos (id, user_id, title, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(input.id, input.userId, input.title, "open", input.nowUtc, input.nowUtc)
        .run();
    },

    async listOpenForUser(userId, limit) {
      return all<TodoRecord>(
        db
          .prepare(
            `
              SELECT id, user_id, title, status, created_at, updated_at, completed_at
              FROM todos
              WHERE user_id = ? AND status = ?
              ORDER BY created_at ASC
              LIMIT ?
            `,
          )
          .bind(userId, "open", limit),
      );
    },

    async complete(userId, todoId, nowUtc) {
      const result = await db
        .prepare(
          `
            UPDATE todos
            SET status = ?, completed_at = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND status = ?
          `,
        )
        .bind("completed", nowUtc, nowUtc, userId, todoId, "open")
        .run();
      return changed(result);
    },
  };
}

function createReminderRepository(db: D1Database): ReminderRepository {
  return {
    async create(input) {
      await db
        .prepare(
          `
            INSERT INTO reminders (
              id, user_id, message, due_at_utc, timezone, status, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .bind(
          input.id,
          input.userId,
          input.message,
          input.dueAtUtc,
          input.timezone ?? "Asia/Taipei",
          "scheduled",
          input.nowUtc,
          input.nowUtc,
        )
        .run();
    },

    async listScheduledForUser(userId, limit) {
      return all<ReminderRecord>(
        db
          .prepare(
            `
              SELECT
                id, user_id, message, due_at_utc, timezone, status, created_at, updated_at,
                sent_at_utc, cancelled_at_utc
              FROM reminders
              WHERE user_id = ? AND status = ?
              ORDER BY due_at_utc ASC
              LIMIT ?
            `,
          )
          .bind(userId, "scheduled", limit),
      );
    },

    async cancel(userId, reminderId, nowUtc) {
      const result = await db
        .prepare(
          `
            UPDATE reminders
            SET status = ?, cancelled_at_utc = ?, updated_at = ?
            WHERE user_id = ? AND id = ? AND status = ?
          `,
        )
        .bind("cancelled", nowUtc, nowUtc, userId, reminderId, "scheduled")
        .run();
      return changed(result);
    },

    async findDueUnsent(nowUtc, limit) {
      const staleProcessingBeforeUtc = new Date(
        new Date(nowUtc).getTime() - PROCESSING_LEASE_MS,
      ).toISOString();
      return all<ReminderRecord>(
        db
          .prepare(
            `
              SELECT
                id, user_id, message, due_at_utc, timezone, status, created_at, updated_at,
                sent_at_utc, cancelled_at_utc
              FROM reminders
              WHERE due_at_utc <= ?
                AND (
                  status = ?
                  OR (status = 'processing' AND updated_at <= ?)
                )
              ORDER BY due_at_utc ASC
              LIMIT ?
            `,
          )
          .bind(nowUtc, "scheduled", staleProcessingBeforeUtc, limit),
      );
    },

    async claimDueReminder(reminderId, sentAtUtc) {
      const staleProcessingBeforeUtc = new Date(
        new Date(sentAtUtc).getTime() - PROCESSING_LEASE_MS,
      ).toISOString();
      const result = await db
        .prepare(
          `
            UPDATE reminders
            SET status = ?, updated_at = ?
            WHERE id = ?
              AND (
                status = ?
                OR (status = ? AND updated_at <= ?)
              )
          `,
        )
        .bind(
          "processing",
          sentAtUtc,
          reminderId,
          "scheduled",
          "processing",
          staleProcessingBeforeUtc,
        )
        .run();
      return changed(result);
    },

    async markReminderSent(reminderId, sentAtUtc) {
      const result = await db
        .prepare(
          `
            UPDATE reminders
            SET status = ?, sent_at_utc = ?, updated_at = ?
            WHERE id = ? AND status = ?
          `,
        )
        .bind("sent", sentAtUtc, sentAtUtc, reminderId, "processing")
        .run();
      return changed(result);
    },

    async releaseDueReminder(reminderId, nowUtc) {
      const result = await db
        .prepare(
          `
            UPDATE reminders
            SET status = ?, updated_at = ?
            WHERE id = ? AND status = ?
          `,
        )
        .bind("scheduled", nowUtc, reminderId, "processing")
        .run();
      return changed(result);
    },
  };
}

function createMemoryRepository(db: D1Database): MemoryRepository {
  return {
    async create(input) {
      await db
        .prepare(
          `
            INSERT INTO memories (id, user_id, content, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(input.id, input.userId, input.content, input.nowUtc, input.nowUtc)
        .run();
    },

    async search(userId, term, limit) {
      return all<MemoryRecord>(
        db
          .prepare(
            `
              SELECT id, user_id, content, created_at, updated_at
              FROM memories
              WHERE user_id = ? AND content LIKE ?
              ORDER BY updated_at DESC
              LIMIT ?
            `,
          )
          .bind(userId, `%${term}%`, limit),
      );
    },

    async listRecent(userId, limit) {
      return all<MemoryRecord>(
        db
          .prepare(
            `
              SELECT id, user_id, content, created_at, updated_at
              FROM memories
              WHERE user_id = ?
              ORDER BY updated_at DESC
              LIMIT ?
            `,
          )
          .bind(userId, limit),
      );
    },

    async delete(userId, memoryId) {
      const result = await db
        .prepare(
          `
            DELETE FROM memories
            WHERE user_id = ? AND id = ?
          `,
        )
        .bind(userId, memoryId)
        .run();
      return changed(result);
    },
  };
}

function createConversationRepository(db: D1Database): ConversationRepository {
  return {
    async addMessage(input) {
      await db
        .prepare(
          `
            INSERT INTO conversation_messages (id, user_id, role, content, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .bind(input.id, input.userId, input.role, input.content, input.createdAtUtc)
        .run();
    },

    async listRecent(userId, limit) {
      return all<ConversationMessageRecord>(
        db
          .prepare(
            `
              SELECT id, user_id, role, content, created_at
              FROM conversation_messages
              WHERE user_id = ?
              ORDER BY created_at DESC
              LIMIT ?
            `,
          )
          .bind(userId, limit),
      );
    },

    async clearRecent(userId) {
      await db
        .prepare(
          `
            DELETE FROM conversation_messages
            WHERE user_id = ?
          `,
        )
        .bind(userId)
        .run();
    },

    async pruneRecent(userId, keep) {
      await db
        .prepare(
          `
            DELETE FROM conversation_messages
            WHERE user_id = ?
              AND id NOT IN (
                SELECT id
                FROM conversation_messages
                WHERE user_id = ?
                ORDER BY created_at DESC
                LIMIT ?
              )
          `,
        )
        .bind(userId, userId, keep)
        .run();
    },
  };
}

function createProcessedEventRepository(db: D1Database): ProcessedEventRepository {
  return {
    async recordIfNew(eventId) {
      const result = await db
        .prepare(
          `
            INSERT OR IGNORE INTO processed_events (event_id)
            VALUES (?)
          `,
        )
        .bind(eventId)
        .run();
      return changed(result);
    },

    async hasProcessed(eventId) {
      const row = await db
        .prepare(
          `
            SELECT event_id
            FROM processed_events
            WHERE event_id = ?
          `,
        )
        .bind(eventId)
        .first<{ event_id: string }>();
      return row !== null;
    },
  };
}

async function all<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

function changed(result: D1Result): boolean {
  return (result.meta.changes ?? 0) > 0;
}
