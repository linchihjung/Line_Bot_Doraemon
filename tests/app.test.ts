import { describe, expect, it, vi } from "vitest";
import type { Repositories } from "../src/db/repositories";
import { createWorker } from "../src/app";
import type { Env } from "../src/types";
import { LlmUnavailableError } from "../src/llm/gemini";

describe("worker", () => {
  it("exports fetch and scheduled handlers", () => {
    const worker = createWorker();

    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });

  it("returns 401 for invalid LINE signatures", async () => {
    const fixture = createFixture({ verifySignature: async () => false });
    const worker = createWorker(fixture.deps);

    const response = await worker.fetch!(
      webhookRequest({ signature: "bad" }),
      fixture.env,
      executionContext(),
    );

    expect(response.status).toBe(401);
    expect(fixture.routeMessage).not.toHaveBeenCalled();
  });

  it("ignores duplicate webhook event IDs before routing or replying", async () => {
    const fixture = createFixture({ recordIfNew: false });
    const worker = createWorker(fixture.deps);

    const response = await worker.fetch!(
      webhookRequest({ eventId: "event-duplicate" }),
      fixture.env,
      executionContext(),
    );

    expect(response.status).toBe(200);
    expect(fixture.repos.processedEvents.recordIfNew).toHaveBeenCalledWith(
      "event-duplicate",
    );
    expect(fixture.routeMessage).not.toHaveBeenCalled();
    expect(fixture.line.reply).not.toHaveBeenCalled();
  });

  it("routes text webhooks with the sender LINE user ID and replies with the result", async () => {
    const fixture = createFixture();
    const worker = createWorker(fixture.deps);

    const response = await worker.fetch!(
      webhookRequest({
        eventId: "event-1",
        userId: "line-user-123",
        text: "記住 我喜歡熱拿鐵",
        replyToken: "reply-token-1",
      }),
      fixture.env,
      executionContext(),
    );

    expect(response.status).toBe(200);
    expect(fixture.routeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "line-user-123",
        text: "記住 我喜歡熱拿鐵",
        userTimezone: "Asia/Taipei",
        setUserTimezone: expect.any(Function),
        clearRecentConversation: expect.any(Function),
        deleteAllUserData: expect.any(Function),
        repos: {
          todos: fixture.repos.todos,
          reminders: fixture.repos.reminders,
          memories: fixture.repos.memories,
          conversations: fixture.repos.conversations,
        },
      }),
    );
    expect(fixture.line.reply).toHaveBeenCalledWith("reply-token-1", "已記住");
  });

  it("uses the sender's stored timezone when routing text webhooks", async () => {
    const fixture = createFixture({ userTimezone: "America/New_York" });
    const worker = createWorker(fixture.deps);

    await worker.fetch!(
      webhookRequest({ userId: "line-user-123" }),
      fixture.env,
      executionContext(),
    );

    expect(fixture.routeMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "line-user-123",
        userTimezone: "America/New_York",
      }),
    );
  });

  it("replies safely when the model is unavailable after event dedupe", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fixture = createFixture({
      routeMessage: vi
        .fn()
        .mockRejectedValue(new LlmUnavailableError("Gemini request failed with 403")),
    });
    const worker = createWorker(fixture.deps);

    try {
      const response = await worker.fetch!(
        webhookRequest({ replyToken: "reply-token-llm" }),
        fixture.env,
        executionContext(),
      );

      expect(response.status).toBe(200);
      expect(fixture.line.reply).toHaveBeenCalledWith(
        "reply-token-llm",
        expect.stringContaining("稍後"),
      );
      expect(warn).toHaveBeenCalledWith(
        "LLM unavailable while processing LINE webhook",
        { message: "Gemini request failed with 403" },
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("passes current UTC time into scheduled reminder processing", async () => {
    const scheduledAt = new Date("2026-07-10T08:30:00.000Z");
    const fixture = createFixture({ now: scheduledAt });
    const worker = createWorker(fixture.deps);

    await worker.scheduled!(
      { scheduledTime: scheduledAt.getTime(), cron: "* * * * *", noRetry: vi.fn() },
      fixture.env,
      executionContext(),
    );

    expect(fixture.processDueReminders).toHaveBeenCalledWith(
      "2026-07-10T08:30:00.000Z",
      {
        reminders: fixture.repos.reminders,
        line: fixture.line,
      },
    );
  });
});

function createFixture(options: {
  verifySignature?: (body: ArrayBuffer, signature: string, secret: string) => Promise<boolean>;
  recordIfNew?: boolean;
  now?: Date;
  userTimezone?: string;
  routeMessage?: ReturnType<typeof vi.fn>;
} = {}) {
  const repos = createRepos(options.recordIfNew ?? true, options.userTimezone);
  const line = {
    reply: vi.fn<(replyToken: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
    push: vi.fn<(userId: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  const routeMessage = options.routeMessage ?? vi.fn().mockResolvedValue({ replyText: "已記住" });
  const processDueReminders = vi
    .fn()
    .mockResolvedValue({ attempted: 0, pushed: 0, skipped: 0, failed: 0 });

  return {
    env: {
      DB: {} as D1Database,
      LINE_CHANNEL_SECRET: "channel-secret",
      LINE_CHANNEL_ACCESS_TOKEN: "channel-token",
      GEMINI_API_KEY: "gemini-key",
    } satisfies Env,
    repos,
    line,
    routeMessage,
    processDueReminders,
    deps: {
      createRepositories: () => repos,
      createLineClient: () => line,
      createGeminiClient: () => ({ generate: vi.fn() }),
      routeMessage,
      processDueReminders,
      verifySignature: options.verifySignature ?? (async () => true),
      now: () => options.now ?? new Date("2026-07-10T08:00:00.000Z"),
    },
  };
}

function createRepos(recordIfNew: boolean, userTimezone = "Asia/Taipei"): Repositories {
  return {
    users: {
      upsert: vi.fn().mockResolvedValue(undefined),
      findById: vi.fn().mockResolvedValue({
        id: "line-user-1",
        display_name: null,
        timezone: userTimezone,
        created_at: "2026-07-10T08:00:00.000Z",
        updated_at: "2026-07-10T08:00:00.000Z",
      }),
      updateTimezone: vi.fn().mockResolvedValue(undefined),
      deleteAllUserData: vi.fn().mockResolvedValue(undefined),
    },
    todos: {
      create: vi.fn(),
      listOpenForUser: vi.fn(),
      complete: vi.fn(),
    },
    reminders: {
      create: vi.fn(),
      listScheduledForUser: vi.fn(),
      cancel: vi.fn(),
      findDueUnsent: vi.fn(),
      claimDueReminder: vi.fn(),
      markReminderSent: vi.fn(),
      releaseDueReminder: vi.fn(),
    },
    memories: {
      create: vi.fn(),
      search: vi.fn(),
      listRecent: vi.fn(),
      delete: vi.fn(),
    },
    conversations: {
      addMessage: vi.fn(),
      listRecent: vi.fn(),
      clearRecent: vi.fn(),
      pruneRecent: vi.fn(),
    },
    processedEvents: {
      recordIfNew: vi.fn().mockResolvedValue(recordIfNew),
      hasProcessed: vi.fn(),
    },
  };
}

function executionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
    props: {},
    tracing: {} as ExecutionContext["tracing"],
  };
}

function webhookRequest(options: {
  signature?: string;
  eventId?: string;
  userId?: string;
  text?: string;
  replyToken?: string;
} = {}): Request<unknown, IncomingRequestCfProperties<unknown>> {
  return new Request("https://example.com/webhook", {
    method: "POST",
    headers: { "x-line-signature": options.signature ?? "valid-signature" },
    body: JSON.stringify({
      events: [
        {
          type: "message",
          mode: "active",
          webhookEventId: options.eventId ?? "event-1",
          replyToken: options.replyToken ?? "reply-token",
          source: { type: "user", userId: options.userId ?? "line-user-1" },
          message: {
            id: "message-1",
            type: "text",
            text: options.text ?? "hello",
          },
          timestamp: 1783670400000,
        },
      ],
    }),
  }) as Request<unknown, IncomingRequestCfProperties<unknown>>;
}
