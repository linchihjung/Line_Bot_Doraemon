import type { Env } from "./types";
import { createRepositories, type Repositories } from "./db/repositories";
import { GeminiClient, LlmUnavailableError } from "./llm/gemini";
import { LineClient } from "./line/client";
import { verifyLineSignature } from "./line/signature";
import { routeMessage, type RouteInput } from "./intent/router";
import {
  processDueReminders,
  type ReminderDependencies,
  type ReminderProcessSummary,
} from "./reminders/processor";

const DEFAULT_USER_TIMEZONE = "Asia/Taipei";

interface LineWebhookPayload {
  events?: unknown;
}

interface LineTextMessageEvent {
  type: "message";
  webhookEventId: string;
  replyToken: string;
  source: {
    type: string;
    userId: string;
  };
  message: {
    type: "text";
    text: string;
  };
}

export interface WorkerDependencies {
  createRepositories(db: D1Database): Repositories;
  createLineClient(channelAccessToken: string): Pick<LineClient, "reply" | "push">;
  createGeminiClient(apiKey: string): Pick<GeminiClient, "generate">;
  routeMessage(input: RouteInput): Promise<{ replyText: string }>;
  processDueReminders(
    nowUtc: string,
    deps: ReminderDependencies,
  ): Promise<ReminderProcessSummary>;
  verifySignature(
    body: ArrayBuffer,
    signature: string,
    secret: string,
  ): Promise<boolean>;
  now(): Date;
}

const defaultDependencies: WorkerDependencies = {
  createRepositories,
  createLineClient: (channelAccessToken) => new LineClient(channelAccessToken),
  createGeminiClient: (apiKey) => new GeminiClient({ apiKey }),
  routeMessage,
  processDueReminders,
  verifySignature: verifyLineSignature,
  now: () => new Date(),
};

export function createWorker(
  overrides: Partial<WorkerDependencies> = {},
): ExportedHandler<Env> {
  const deps = { ...defaultDependencies, ...overrides };

  return {
    async fetch(request, env, _ctx) {
      const url = new URL(request.url);

      if (request.method !== "POST" || url.pathname !== "/webhook") {
        return new Response("Not Found", { status: 404 });
      }

      const body = await request.arrayBuffer();
      const signature = request.headers.get("x-line-signature") ?? "";
      const isVerified = await deps.verifySignature(
        body,
        signature,
        env.LINE_CHANNEL_SECRET,
      );

      if (!isVerified) {
        return new Response("Unauthorized", { status: 401 });
      }

      let payload: LineWebhookPayload;
      try {
        payload = JSON.parse(new TextDecoder().decode(body)) as LineWebhookPayload;
      } catch {
        return new Response("Bad Request", { status: 400 });
      }

      if (!Array.isArray(payload.events)) {
        return new Response("Bad Request", { status: 400 });
      }

      const repos = deps.createRepositories(env.DB);
      const line = deps.createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
      const gemini = deps.createGeminiClient(env.GEMINI_API_KEY);

      try {
        for (const event of payload.events) {
          if (!isLineTextMessageEvent(event)) {
            continue;
          }

          const isNew = await repos.processedEvents.recordIfNew(event.webhookEventId);
          if (!isNew) {
            continue;
          }

          const userId = event.source.userId;
          await repos.users.upsert(userId);
          const user = await repos.users.findById(userId);

          try {
            const result = await deps.routeMessage({
              userId,
              text: event.message.text,
              now: deps.now(),
              userTimezone: user?.timezone ?? DEFAULT_USER_TIMEZONE,
              repos: {
                todos: repos.todos,
                reminders: repos.reminders,
                memories: repos.memories,
                conversations: repos.conversations,
              },
              gemini,
              setUserTimezone: async (targetUserId, timezone, nowUtc) => {
                await repos.users.updateTimezone(targetUserId, timezone, nowUtc);
              },
              clearRecentConversation: repos.conversations.clearRecent,
              deleteAllUserData: async (targetUserId) => {
                await repos.users.deleteAllUserData(targetUserId);
              },
            });

            await line.reply(event.replyToken, result.replyText);
          } catch (error) {
            if (error instanceof LlmUnavailableError) {
              await line.reply(
                event.replyToken,
                "我現在有點連不上模型，請稍後再試一次。",
              );
              continue;
            }

            throw error;
          }
        }

        return new Response("OK", { status: 200 });
      } catch {
        return new Response("Internal Server Error", { status: 500 });
      }
    },

    async scheduled(controller, env, _ctx) {
      const repos = deps.createRepositories(env.DB);
      const line = deps.createLineClient(env.LINE_CHANNEL_ACCESS_TOKEN);
      const scheduledTime = new Date(controller.scheduledTime).toISOString();

      await deps.processDueReminders(scheduledTime, {
        reminders: repos.reminders,
        line,
      });
    },
  };
}

function isLineTextMessageEvent(event: unknown): event is LineTextMessageEvent {
  if (!event || typeof event !== "object") {
    return false;
  }

  const candidate = event as {
    type?: unknown;
    webhookEventId?: unknown;
    replyToken?: unknown;
    source?: { type?: unknown; userId?: unknown };
    message?: { type?: unknown; text?: unknown };
  };

  return (
    candidate.type === "message" &&
    typeof candidate.webhookEventId === "string" &&
    typeof candidate.replyToken === "string" &&
    candidate.source?.type === "user" &&
    typeof candidate.source.userId === "string" &&
    candidate.message?.type === "text" &&
    typeof candidate.message.text === "string"
  );
}

const worker = createWorker();

export default worker;
