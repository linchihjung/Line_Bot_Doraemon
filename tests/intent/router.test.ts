import { describe, expect, it, vi } from "vitest";
import { routeMessage, type RouteInput } from "../../src/intent/router";
import type {
  ConversationMessageRecord,
  ConversationRepository,
  MemoryRecord,
  MemoryRepository,
  ReminderRecord,
  ReminderRepository,
  TodoRecord,
  TodoRepository,
} from "../../src/db/repositories";
import type { GeminiClient, GeminiResult } from "../../src/llm/gemini";

const NOW = new Date("2026-07-10T08:00:00.000Z");

describe("routeMessage", () => {
  it("writes explicit memory commands without calling Gemini", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "記住 我喜歡熱拿鐵" }));

    expect(result.replyText).toContain("已記住");
    expect(fixture.memories.records).toMatchObject([
      { id: "id-1", user_id: "user-a", content: "我喜歡熱拿鐵" },
    ]);
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("does not create duplicate explicit memories for the same user and content", async () => {
    const fixture = createFixture();

    await routeMessage(fixture.input({ text: "記住 我喜歡無糖茶" }));
    const duplicateResult = await routeMessage(
      fixture.input({ text: "記住 我喜歡無糖茶" }),
    );

    expect(duplicateResult.replyText).toContain("已經記得");
    expect(fixture.memories.records).toMatchObject([
      { id: "id-1", user_id: "user-a", content: "我喜歡無糖茶" },
    ]);
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("warns and skips writes for sensitive explicit memory commands", async () => {
    const fixture = createFixture();

    const result = await routeMessage(
      fixture.input({ text: "記住 我的 password 是 hunter2" }),
    );

    expect(result.replyText).toContain("敏感");
    expect(fixture.memories.records).toEqual([]);
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("treats ambiguous natural statements as chat without long-term memory writes", async () => {
    const fixture = createFixture({
      geminiResult: { type: "chat", text: "聽起來你最近真的很累。" },
    });

    const result = await routeMessage(fixture.input({ text: "最近好累" }));

    expect(result.replyText).toBe("聽起來你最近真的很累。");
    expect(fixture.memories.records).toEqual([]);
    expect(fixture.conversations.records.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
  });

  it("creates, lists, and completes todos with user-scoped repositories", async () => {
    const fixture = createFixture();

    await routeMessage(fixture.input({ text: "新增待辦 買牛奶" }));
    await routeMessage(fixture.input({ text: "新增待辦 繳電費" }));
    const listResult = await routeMessage(fixture.input({ text: "待辦列表" }));
    const completeResult = await routeMessage(fixture.input({ text: "完成待辦 id-1" }));

    expect(fixture.todos.records).toMatchObject([
      { id: "id-1", user_id: "user-a", title: "買牛奶", status: "completed" },
      { id: "id-2", user_id: "user-a", title: "繳電費", status: "open" },
    ]);
    expect(listResult.replyText).toContain("id-1");
    expect(listResult.replyText).toContain("買牛奶");
    expect(completeResult.replyText).toContain("已完成");
    expect(fixture.todos.completeCalls).toEqual([
      { userId: "user-a", todoId: "id-1", nowUtc: NOW.toISOString() },
    ]);
  });

  it("creates reminders from explicit complete offset or local datetimes", async () => {
    const fixture = createFixture();

    await routeMessage(
      fixture.input({ text: "提醒 2026-07-11T09:00:00+08:00 繳電費" }),
    );
    await routeMessage(fixture.input({ text: "提醒 2026-07-12T10:30 開會" }));

    expect(fixture.reminders.records).toMatchObject([
      {
        id: "id-1",
        user_id: "user-a",
        message: "繳電費",
        due_at_utc: "2026-07-11T01:00:00.000Z",
      },
      {
        id: "id-2",
        user_id: "user-a",
        message: "開會",
        due_at_utc: "2026-07-12T02:30:00.000Z",
      },
    ]);
  });

  it("creates natural language reminders without calling Gemini", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "明天早上九點提醒我開會" }));

    expect(result.replyText).toContain("已設定提醒");
    expect(fixture.reminders.records).toMatchObject([
      {
        id: "id-1",
        user_id: "user-a",
        message: "開會",
        due_at_utc: "2026-07-11T01:00:00.000Z",
      },
    ]);
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("asks for clarification when explicit reminders lack complete date and time", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "提醒 明天 繳電費" }));

    expect(result.replyText).toContain("日期和時間");
    expect(fixture.reminders.records).toEqual([]);
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("falls back to Gemini for unsupported natural reminder phrasing", async () => {
    const fixture = createFixture({
      geminiResult: {
        type: "intent",
        intent: {
          intent: "create_reminder",
          content: "整理房間",
          due_at: "2026-07-12T10:00:00+08:00",
        },
      },
    });

    const result = await routeMessage(fixture.input({ text: "週末提醒我整理房間" }));

    expect(result.replyText).toContain("已設定提醒");
    expect(fixture.gemini.generate).toHaveBeenCalledOnce();
    expect(fixture.reminders.records).toMatchObject([
      {
        id: "id-1",
        user_id: "user-a",
        message: "整理房間",
        due_at_utc: "2026-07-12T02:00:00.000Z",
      },
    ]);
  });

  it("lists and deletes memories with user scope", async () => {
    const fixture = createFixture();
    await routeMessage(fixture.input({ text: "記住 我喜歡熱拿鐵" }));
    await routeMessage(fixture.input({ text: "記住 我住在台北" }));

    const listResult = await routeMessage(fixture.input({ text: "列出記憶" }));
    const deleteResult = await routeMessage(fixture.input({ text: "刪除記憶 id-1" }));

    expect(listResult.replyText).toContain("id-1");
    expect(listResult.replyText).toContain("我喜歡熱拿鐵");
    expect(deleteResult.replyText).toContain("已刪除");
    expect(fixture.memories.deleteCalls).toEqual([{ userId: "user-a", memoryId: "id-1" }]);
    expect(fixture.memories.records.map((memory) => memory.id)).toEqual(["id-2"]);
  });

  it("normalizes timezone commands and stores through an injected dependency", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "設定時區 Asia/Taipei" }));

    expect(result.replyText).toContain("Asia/Taipei");
    expect(fixture.setTimezone).toHaveBeenCalledWith(
      "user-a",
      "Asia/Taipei",
      NOW.toISOString(),
    );
  });

  it("does not pretend timezone persistence succeeded when dependency is missing", async () => {
    const fixture = createFixture();

    const result = await routeMessage(
      fixture.input({ text: "設定時區 Asia/Taipei", setUserTimezone: undefined }),
    );

    expect(result.replyText).toContain("目前無法設定時區");
    expect(result.replyText).not.toContain("已設定時區");
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("returns a safe reply for invalid explicit timezone commands without Gemini", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "設定時區 Mars/Base" }));

    expect(result.replyText).toContain("不支援");
    expect(fixture.setTimezone).not.toHaveBeenCalled();
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("clears recent conversation through an injected dependency", async () => {
    const fixture = createFixture();

    const result = await routeMessage(fixture.input({ text: "清除近期對話" }));

    expect(result.replyText).toContain("已清除近期對話");
    expect(fixture.clearRecentConversation).toHaveBeenCalledWith(
      "user-a",
      NOW.toISOString(),
    );
    expect(fixture.gemini.generate).not.toHaveBeenCalled();
  });

  it("lists and cancels reminders with user-scoped repositories", async () => {
    const fixture = createFixture();
    await routeMessage(fixture.input({ text: "提醒 2026-07-11T09:00:00+08:00 繳電費" }));
    await routeMessage(fixture.input({ text: "提醒 2026-07-12T10:30 開會" }));

    const listResult = await routeMessage(fixture.input({ text: "提醒列表" }));
    const cancelResult = await routeMessage(fixture.input({ text: "取消提醒 id-1" }));

    expect(listResult.replyText).toContain("id-1");
    expect(listResult.replyText).toContain("繳電費");
    expect(cancelResult.replyText).toContain("已取消");
    expect(fixture.reminders.listCalls).toEqual([{ userId: "user-a", limit: 10 }]);
    expect(fixture.reminders.cancelCalls).toEqual([
      { userId: "user-a", reminderId: "id-1", nowUtc: NOW.toISOString() },
    ]);
    expect(fixture.reminders.records).toMatchObject([
      { id: "id-1", user_id: "user-a", status: "cancelled" },
      { id: "id-2", user_id: "user-a", status: "scheduled" },
    ]);
  });

  it("stores bounded recent user and assistant chat messages only", async () => {
    const fixture = createFixture({
      recentMessages: Array.from({ length: 20 }, (_, index) => ({
        id: `old-${index}`,
        user_id: "user-a",
        role: index % 2 === 0 ? "user" : "assistant",
        content: `old message ${index}`,
        created_at: `2026-07-10T07:${String(index).padStart(2, "0")}:00.000Z`,
      })),
      geminiResult: { type: "chat", text: "好的，我陪你整理一下。" },
    });

    await routeMessage(fixture.input({ text: "幫我想晚餐" }));

    expect(fixture.conversations.listCalls).toEqual([{ userId: "user-a", limit: 8 }]);
    expect(fixture.gemini.generate).toHaveBeenCalledWith({
      message: "幫我想晚餐",
      timezone: "Asia/Taipei",
      nowUtc: NOW.toISOString(),
      recentMessages: expect.arrayContaining([
        { role: "assistant", content: "old message 19" },
      ]),
    });
    expect(fixture.memories.records).toEqual([]);
    expect(fixture.conversations.records.slice(-2).map((message) => message.content)).toEqual([
      "幫我想晚餐",
      "好的，我陪你整理一下。",
    ]);
    expect(fixture.conversations.pruneCalls).toEqual([{ userId: "user-a", keep: 8 }]);
  });

  it("validates and routes model structured intents but refuses model-only all-data deletion", async () => {
    const fixture = createFixture({
      geminiResults: [
        { type: "intent", intent: { intent: "create_todo", content: "整理發票" } },
        { type: "intent", intent: { intent: "delete_all_data" } as never },
      ],
    });

    const todoResult = await routeMessage(fixture.input({ text: "我需要處理發票" }));
    const deleteResult = await routeMessage(fixture.input({ text: "把我的資料都處理掉" }));

    expect(todoResult.replyText).toContain("已新增待辦");
    expect(fixture.todos.records).toMatchObject([{ title: "整理發票", user_id: "user-a" }]);
    expect(deleteResult.replyText).toContain("無法執行");
    expect(fixture.deleteAllUserData).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmation phrase before deleting all user data", async () => {
    const fixture = createFixture();

    const vagueResult = await routeMessage(fixture.input({ text: "刪除所有資料" }));
    const confirmedResult = await routeMessage(
      fixture.input({ text: "確認刪除所有資料" }),
    );

    expect(vagueResult.replyText).toContain("確認刪除所有資料");
    expect(fixture.deleteAllUserData).toHaveBeenCalledOnce();
    expect(fixture.deleteAllUserData).toHaveBeenCalledWith("user-a", NOW.toISOString());
    expect(confirmedResult.replyText).toContain("已刪除所有資料");
  });
});

function createFixture(options: {
  geminiResult?: GeminiResult;
  geminiResults?: GeminiResult[];
  recentMessages?: ConversationMessageRecord[];
} = {}) {
  let nextId = 1;
  const todos = new FakeTodoRepository();
  const reminders = new FakeReminderRepository();
  const memories = new FakeMemoryRepository();
  const conversations = new FakeConversationRepository(options.recentMessages ?? []);
  const geminiResults = [...(options.geminiResults ?? [])];
  const gemini = {
    generate: vi.fn(async () => {
      const defaultResult: GeminiResult = { type: "chat", text: "OK" };
      return geminiResults.shift() ?? options.geminiResult ?? defaultResult;
    }),
  } satisfies Pick<GeminiClient, "generate">;
  const setTimezone = vi.fn(async () => undefined);
  const clearRecentConversation = vi.fn(async () => undefined);
  const deleteAllUserData = vi.fn(async () => undefined);

  return {
    todos,
    reminders,
    memories,
    conversations,
    gemini,
    setTimezone,
    clearRecentConversation,
    deleteAllUserData,
    input(overrides: Partial<RouteInput>): RouteInput {
      return {
        userId: "user-a",
        text: "",
        now: NOW,
        userTimezone: "Asia/Taipei",
        repos: { todos, reminders, memories, conversations },
        gemini,
        idGenerator: () => `id-${nextId++}`,
        setUserTimezone: setTimezone,
        clearRecentConversation,
        deleteAllUserData,
        ...overrides,
      };
    },
  };
}

class FakeTodoRepository implements TodoRepository {
  readonly records: TodoRecord[] = [];
  readonly completeCalls: Array<{ userId: string; todoId: string; nowUtc: string }> = [];

  async create(input: {
    id: string;
    userId: string;
    title: string;
    nowUtc: string;
  }): Promise<void> {
    this.records.push({
      id: input.id,
      user_id: input.userId,
      title: input.title,
      status: "open",
      created_at: input.nowUtc,
      updated_at: input.nowUtc,
      completed_at: null,
    });
  }

  async listOpenForUser(userId: string, limit: number): Promise<TodoRecord[]> {
    return this.records
      .filter((todo) => todo.user_id === userId && todo.status === "open")
      .slice(0, limit);
  }

  async complete(userId: string, todoId: string, nowUtc: string): Promise<boolean> {
    this.completeCalls.push({ userId, todoId, nowUtc });
    const todo = this.records.find(
      (record) => record.user_id === userId && record.id === todoId && record.status === "open",
    );
    if (!todo) {
      return false;
    }
    todo.status = "completed";
    todo.completed_at = nowUtc;
    todo.updated_at = nowUtc;
    return true;
  }
}

class FakeReminderRepository implements ReminderRepository {
  readonly records: ReminderRecord[] = [];
  readonly listCalls: Array<{ userId: string; limit: number }> = [];
  readonly cancelCalls: Array<{ userId: string; reminderId: string; nowUtc: string }> = [];

  async create(input: {
    id: string;
    userId: string;
    message: string;
    dueAtUtc: string;
    nowUtc: string;
  }): Promise<void> {
    this.records.push({
      id: input.id,
      user_id: input.userId,
      message: input.message,
      due_at_utc: input.dueAtUtc,
      status: "scheduled",
      timezone: "Asia/Taipei",
      created_at: input.nowUtc,
      updated_at: input.nowUtc,
      sent_at_utc: null,
      cancelled_at_utc: null,
    });
  }

  async listScheduledForUser(userId: string, limit: number): Promise<ReminderRecord[]> {
    this.listCalls.push({ userId, limit });
    return this.records
      .filter((reminder) => reminder.user_id === userId && reminder.status === "scheduled")
      .slice(0, limit);
  }

  async cancel(userId: string, reminderId: string, nowUtc: string): Promise<boolean> {
    this.cancelCalls.push({ userId, reminderId, nowUtc });
    const reminder = this.records.find(
      (record) =>
        record.user_id === userId && record.id === reminderId && record.status === "scheduled",
    );
    if (!reminder) {
      return false;
    }
    reminder.status = "cancelled";
    reminder.cancelled_at_utc = nowUtc;
    reminder.updated_at = nowUtc;
    return true;
  }

  async findDueUnsent(): Promise<ReminderRecord[]> {
    return [];
  }

  async claimDueReminder(): Promise<boolean> {
    return false;
  }

  async markReminderSent(): Promise<boolean> {
    return false;
  }

  async releaseDueReminder(): Promise<boolean> {
    return false;
  }
}

class FakeMemoryRepository implements MemoryRepository {
  readonly records: MemoryRecord[] = [];
  readonly deleteCalls: Array<{ userId: string; memoryId: string }> = [];

  async create(input: {
    id: string;
    userId: string;
    content: string;
    nowUtc: string;
  }): Promise<void> {
    this.records.push({
      id: input.id,
      user_id: input.userId,
      content: input.content,
      created_at: input.nowUtc,
      updated_at: input.nowUtc,
    });
  }

  async search(userId: string, term: string, limit: number): Promise<MemoryRecord[]> {
    return this.records
      .filter((memory) => memory.user_id === userId && memory.content.includes(term))
      .slice(0, limit);
  }

  async listRecent(userId: string, limit: number): Promise<MemoryRecord[]> {
    return this.records.filter((memory) => memory.user_id === userId).slice(0, limit);
  }

  async delete(userId: string, memoryId: string): Promise<boolean> {
    this.deleteCalls.push({ userId, memoryId });
    const index = this.records.findIndex(
      (memory) => memory.user_id === userId && memory.id === memoryId,
    );
    if (index === -1) {
      return false;
    }
    this.records.splice(index, 1);
    return true;
  }
}

class FakeConversationRepository implements ConversationRepository {
  readonly records: ConversationMessageRecord[];
  readonly listCalls: Array<{ userId: string; limit: number }> = [];
  readonly pruneCalls: Array<{ userId: string; keep: number }> = [];

  constructor(records: ConversationMessageRecord[]) {
    this.records = [...records];
  }

  async addMessage(input: {
    id: string;
    userId: string;
    role: "user" | "assistant" | "system";
    content: string;
    createdAtUtc: string;
  }): Promise<void> {
    this.records.push({
      id: input.id,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      created_at: input.createdAtUtc,
    });
  }

  async listRecent(userId: string, limit: number): Promise<ConversationMessageRecord[]> {
    this.listCalls.push({ userId, limit });
    return this.records
      .filter((message) => message.user_id === userId)
      .slice(-limit)
      .reverse();
  }

  async clearRecent(userId: string): Promise<void> {
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (this.records[index]?.user_id === userId) {
        this.records.splice(index, 1);
      }
    }
  }

  async pruneRecent(userId: string, keep: number): Promise<void> {
    this.pruneCalls.push({ userId, keep });
    const userMessages = this.records.filter((message) => message.user_id === userId);
    const deleteCount = Math.max(0, userMessages.length - keep);
    const deleteIds = new Set(userMessages.slice(0, deleteCount).map((message) => message.id));
    for (let index = this.records.length - 1; index >= 0; index -= 1) {
      if (deleteIds.has(this.records[index]?.id ?? "")) {
        this.records.splice(index, 1);
      }
    }
  }
}
