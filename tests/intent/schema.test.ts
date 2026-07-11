import { describe, expect, it } from "vitest";
import { allowedIntents, intentSchema } from "../../src/intent/schema";

describe("intentSchema", () => {
  it("accepts every allowed intent", () => {
    const minimalPayloads = [
      { intent: "chat", text: "你好" },
      { intent: "create_todo", content: "買牛奶" },
      { intent: "list_todos" },
      { intent: "complete_todo", todo_id: "todo-1" },
      { intent: "create_memory", content: "我喜歡熱拿鐵" },
      { intent: "list_memories" },
      { intent: "delete_memory", memory_id: "memory-1" },
      {
        intent: "create_reminder",
        content: "繳電費",
        due_at: "2026-07-11T09:00:00+08:00",
      },
      { intent: "list_reminders" },
      { intent: "cancel_reminder", reminder_id: "reminder-1" },
      { intent: "set_timezone", timezone: "Asia/Taipei" },
    ];

    expect(minimalPayloads.map((payload) => intentSchema.parse(payload).intent)).toEqual(
      allowedIntents,
    );
  });

  it("rejects unknown intents", () => {
    expect(() => intentSchema.parse({ intent: "send_email", content: "hi" })).toThrow();
  });

  it("rejects malformed reminder dates", () => {
    expect(() =>
      intentSchema.parse({
        intent: "create_reminder",
        content: "繳電費",
        due_at: "tomorrow morning",
      }),
    ).toThrow();
  });

  it("rejects unknown fields on intent objects", () => {
    expect(() =>
      intentSchema.parse({
        intent: "create_todo",
        content: "買牛奶",
        priority: "high",
      }),
    ).toThrow();
  });

  it("normalizes set_timezone values", () => {
    expect(
      intentSchema.parse({
        intent: "set_timezone",
        timezone: " Asia/Taipei ",
      }),
    ).toEqual({ intent: "set_timezone", timezone: "Asia/Taipei" });
  });
});
