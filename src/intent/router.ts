import type {
  ConversationRepository,
  MemoryRepository,
  ReminderRepository,
  TodoRepository,
} from "../db/repositories";
import type { GeminiClient, GeminiResult } from "../llm/gemini";
import type { WebSearchClient, WebSearchResult } from "../search/tavily";
import { isSensitiveContent } from "../security/sensitive-content";
import { parseTimezone, toUtcIso } from "../timezone";
import {
  NATURAL_REMINDER_CLARIFICATION_REPLY,
  needsNaturalReminderClarification,
  parseNaturalReminder,
} from "./natural-reminder";
import { intentSchema, type Intent } from "./schema";

const RECENT_MESSAGE_LIMIT = 8;
const LIST_LIMIT = 10;
const MEMORY_SENSITIVE_WARNING =
  "這看起來包含敏感資訊，我不會把它存進長期記憶。";
const DELETE_ALL_CONFIRMATION = "確認刪除所有資料";

export interface RouteInput {
  userId: string;
  text: string;
  now: Date | string;
  userTimezone: string;
  repos: {
    todos: TodoRepository;
    reminders: ReminderRepository;
    memories: MemoryRepository;
    conversations: ConversationRepository;
  };
  gemini: Pick<GeminiClient, "generate">;
  webSearch?: Pick<WebSearchClient, "search">;
  idGenerator?: () => string;
  setUserTimezone?: (
    userId: string,
    timezone: string,
    nowUtc: string,
  ) => Promise<void>;
  clearRecentConversation?: (userId: string, nowUtc: string) => Promise<void>;
  deleteAllUserData?: (userId: string, nowUtc: string) => Promise<void>;
}

export interface RouteResult {
  replyText: string;
}

type ExplicitCommand =
  | { type: "create_memory"; content: string }
  | { type: "list_memories" }
  | { type: "delete_memory"; memoryId: string }
  | { type: "create_todo"; title: string }
  | { type: "list_todos" }
  | { type: "complete_todo"; todoId: string }
  | { type: "create_reminder"; dueAtUtc?: string; message?: string; needsClarification?: true }
  | { type: "list_reminders" }
  | { type: "cancel_reminder"; reminderId: string }
  | { type: "set_timezone"; timezone: string }
  | { type: "invalid_timezone"; timezone: string }
  | { type: "clear_recent_conversation" }
  | { type: "delete_all_data"; confirmed: boolean };

export async function routeMessage(input: RouteInput): Promise<RouteResult> {
  const text = input.text.trim();
  const nowUtc = normalizeNow(input.now);
  const timezone = parseTimezone(input.userTimezone, "UTC");
  const nextId = input.idGenerator ?? (() => crypto.randomUUID());

  const naturalReminder = parseNaturalReminder(text, { nowUtc, timezone });
  if (naturalReminder) {
    return createReminder(
      input,
      naturalReminder.message,
      naturalReminder.dueAtUtc,
      nowUtc,
      nextId,
    );
  }

  if (needsNaturalReminderClarification(text)) {
    return {
      replyText: NATURAL_REMINDER_CLARIFICATION_REPLY,
    };
  }

  const explicitCommand = parseExplicitCommand(text, timezone);
  if (explicitCommand) {
    return executeExplicitCommand(input, explicitCommand, nowUtc, nextId);
  }

  const searchQuery = parseWebSearchQuery(text);
  if (searchQuery) {
    if (!input.webSearch) {
      return { replyText: "網路搜尋功能尚未設定，請稍後再試。" };
    }

    try {
      const results = await input.webSearch.search(searchQuery);
      return { replyText: formatSearchResults(searchQuery, results) };
    } catch (error) {
      console.warn("Web search failed", {
        message: error instanceof Error ? error.message : "Unknown web search error",
      });
      return { replyText: "我現在暫時無法完成網路搜尋，請稍後再試。" };
    }
  }

  const recentMessages = await input.repos.conversations.listRecent(
    input.userId,
    RECENT_MESSAGE_LIMIT,
  );
  const modelResult = await input.gemini.generate({
    message: text,
    timezone,
    nowUtc,
    recentMessages: recentMessages
      .slice()
      .reverse()
      .filter(
        (
          message,
        ): message is typeof message & { role: "user" | "assistant" } =>
          message.role === "user" || message.role === "assistant",
      )
      .map((message) => ({ role: message.role, content: message.content })),
  });

  return executeModelResult(input, modelResult, text, nowUtc, nextId);
}

function parseWebSearchQuery(text: string): string | undefined {
  const match = /^(?:請)?(?:幫我)?(?:搜尋|查詢|查一下|找一下|上網查|網路搜尋)\s*(.+)$/.exec(
    text,
  );
  return match?.[1]?.trim() || undefined;
}

function formatSearchResults(query: string, results: WebSearchResult[]): string {
  if (results.length === 0) {
    return `我沒有找到「${query}」的搜尋結果。`;
  }

  return [
    `這是「${query}」的搜尋結果：`,
    ...results.map(
      (result, index) => `${index + 1}. ${result.title}\n${result.snippet}\n來源：${result.url}`,
    ),
  ].join("\n\n");
}

async function executeExplicitCommand(
  input: RouteInput,
  command: ExplicitCommand,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  switch (command.type) {
    case "create_memory":
      return createMemory(input, command.content, nowUtc, nextId);
    case "list_memories":
      return listMemories(input);
    case "delete_memory":
      return deleteMemory(input, command.memoryId);
    case "create_todo":
      return createTodo(input, command.title, nowUtc, nextId);
    case "list_todos":
      return listTodos(input);
    case "complete_todo":
      return completeTodo(input, command.todoId, nowUtc);
    case "create_reminder":
      if (command.needsClarification || !command.dueAtUtc || !command.message) {
        return {
          replyText:
            "請提供完整的日期和時間，例如：提醒 2026-07-11T09:00 繳電費。",
        };
      }
      return createReminder(input, command.message, command.dueAtUtc, nowUtc, nextId);
    case "list_reminders":
      return listReminders(input);
    case "cancel_reminder":
      return cancelReminder(input, command.reminderId, nowUtc);
    case "set_timezone":
      return setTimezone(input, command.timezone, nowUtc);
    case "invalid_timezone":
      return { replyText: `不支援這個時區：${command.timezone}` };
    case "clear_recent_conversation":
      return clearRecentConversation(input, nowUtc);
    case "delete_all_data":
      return deleteAllData(input, command.confirmed, nowUtc);
  }
}

async function executeModelResult(
  input: RouteInput,
  result: GeminiResult,
  originalText: string,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  if (result.type === "chat") {
    await storeChatTurn(input, originalText, result.text, nowUtc, nextId);
    return { replyText: result.text };
  }

  const parsed = intentSchema.safeParse(result.intent);
  if (!parsed.success) {
    return { replyText: "我無法執行這個操作，請用明確指令再說一次。" };
  }

  return executeIntent(input, parsed.data, originalText, nowUtc, nextId);
}

async function executeIntent(
  input: RouteInput,
  intent: Intent,
  originalText: string,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  switch (intent.intent) {
    case "chat": {
      await storeChatTurn(input, originalText, intent.text, nowUtc, nextId);
      return { replyText: intent.text };
    }
    case "create_todo":
      return createTodo(input, intent.content, nowUtc, nextId);
    case "list_todos":
      return listTodos(input);
    case "complete_todo":
      return completeTodo(input, intent.todo_id, nowUtc);
    case "create_memory":
      return {
        replyText: "我需要你用「記住 ...」明確確認後，才會存成長期記憶。",
      };
    case "list_memories":
      return listMemories(input);
    case "delete_memory":
      return deleteMemory(input, intent.memory_id);
    case "create_reminder":
      return createReminder(
        input,
        intent.content,
        new Date(intent.due_at).toISOString(),
        nowUtc,
        nextId,
      );
    case "list_reminders":
      return listReminders(input);
    case "cancel_reminder":
      return cancelReminder(input, intent.reminder_id, nowUtc);
    case "set_timezone":
      return setTimezone(input, intent.timezone, nowUtc);
  }
}

function parseExplicitCommand(text: string, timezone: string): ExplicitCommand | undefined {
  if (text === DELETE_ALL_CONFIRMATION) {
    return { type: "delete_all_data", confirmed: true };
  }

  if (/^刪除所有資料$/.test(text)) {
    return { type: "delete_all_data", confirmed: false };
  }

  if (/^(?:清除近期對話|清除對話|忘記近期對話)$/.test(text)) {
    return { type: "clear_recent_conversation" };
  }

  const memoryCreate = /^(?:記住|請記住|幫我記住)\s*[:：]?\s*(.+)$/.exec(text);
  if (memoryCreate) {
    return { type: "create_memory", content: memoryCreate[1].trim() };
  }

  if (/^(?:列出記憶|記憶列表|我的記憶)$/.test(text)) {
    return { type: "list_memories" };
  }

  const memoryDelete = /^(?:刪除記憶|移除記憶)\s+(\S+)$/.exec(text);
  if (memoryDelete) {
    return { type: "delete_memory", memoryId: memoryDelete[1] };
  }

  const todoCreate = /^(?:新增待辦|加入待辦|待辦新增)\s*[:：]?\s*(.+)$/.exec(text);
  if (todoCreate) {
    return { type: "create_todo", title: todoCreate[1].trim() };
  }

  if (/^(?:待辦列表|列出待辦|查看待辦)$/.test(text)) {
    return { type: "list_todos" };
  }

  const todoComplete = /^(?:完成待辦|待辦完成)\s+(\S+)$/.exec(text);
  if (todoComplete) {
    return { type: "complete_todo", todoId: todoComplete[1] };
  }

  const reminderCreate = /^(?:提醒|新增提醒)\s+(\S+)\s+(.+)$/.exec(text);
  if (reminderCreate) {
    const dueAtUtc = parseExplicitReminderTime(reminderCreate[1], timezone);
    if (!dueAtUtc) {
      return { type: "create_reminder", needsClarification: true };
    }
    return {
      type: "create_reminder",
      dueAtUtc,
      message: reminderCreate[2].trim(),
    };
  }

  if (/^(?:提醒列表|列出提醒|查看提醒)$/.test(text)) {
    return { type: "list_reminders" };
  }

  const reminderCancel = /^(?:取消提醒|刪除提醒)\s+(\S+)$/.exec(text);
  if (reminderCancel) {
    return { type: "cancel_reminder", reminderId: reminderCancel[1] };
  }

  const timezoneSet = /^(?:設定時區|時區)\s+(.+)$/.exec(text);
  if (timezoneSet) {
    const requestedTimezone = timezoneSet[1].trim();
    try {
      return { type: "set_timezone", timezone: parseTimezone(requestedTimezone, timezone) };
    } catch {
      return { type: "invalid_timezone", timezone: requestedTimezone };
    }
  }

  return undefined;
}

function parseExplicitReminderTime(value: string, timezone: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString();
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
    try {
      return toUtcIso(value, timezone);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

async function createMemory(
  input: RouteInput,
  content: string,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  if (isSensitiveContent(content)) {
    return { replyText: MEMORY_SENSITIVE_WARNING };
  }

  const existingMemories = await input.repos.memories.search(input.userId, content, 1);
  if (existingMemories.some((memory) => memory.content === content)) {
    return { replyText: `我已經記得囉：${content}` };
  }

  await input.repos.memories.create({
    id: nextId(),
    userId: input.userId,
    content,
    nowUtc,
  });

  return { replyText: `已記住：${content}` };
}

async function listMemories(input: RouteInput): Promise<RouteResult> {
  const memories = await input.repos.memories.listRecent(input.userId, LIST_LIMIT);
  if (memories.length === 0) {
    return { replyText: "目前沒有長期記憶。" };
  }

  return {
    replyText: memories
      .map((memory, index) => `${index + 1}. ${memory.id} ${memory.content}`)
      .join("\n"),
  };
}

async function deleteMemory(input: RouteInput, memoryId: string): Promise<RouteResult> {
  const deleted = await input.repos.memories.delete(input.userId, memoryId);
  return { replyText: deleted ? "已刪除這筆記憶。" : "找不到這筆記憶。" };
}

async function createTodo(
  input: RouteInput,
  title: string,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  await input.repos.todos.create({
    id: nextId(),
    userId: input.userId,
    title,
    nowUtc,
  });

  return { replyText: `已新增待辦：${title}` };
}

async function listTodos(input: RouteInput): Promise<RouteResult> {
  const todos = await input.repos.todos.listOpenForUser(input.userId, LIST_LIMIT);
  if (todos.length === 0) {
    return { replyText: "目前沒有未完成待辦。" };
  }

  return {
    replyText: todos.map((todo, index) => `${index + 1}. ${todo.id} ${todo.title}`).join("\n"),
  };
}

async function completeTodo(
  input: RouteInput,
  todoId: string,
  nowUtc: string,
): Promise<RouteResult> {
  const completed = await input.repos.todos.complete(input.userId, todoId, nowUtc);
  return { replyText: completed ? "已完成這項待辦。" : "找不到這項未完成待辦。" };
}

async function createReminder(
  input: RouteInput,
  message: string,
  dueAtUtc: string,
  nowUtc: string,
  nextId: () => string,
): Promise<RouteResult> {
  await input.repos.reminders.create({
    id: nextId(),
    userId: input.userId,
    message,
    dueAtUtc,
    timezone: input.userTimezone,
    nowUtc,
  });

  return { replyText: `已設定提醒：${message}` };
}

async function listReminders(input: RouteInput): Promise<RouteResult> {
  const reminders = await input.repos.reminders.listScheduledForUser(
    input.userId,
    LIST_LIMIT,
  );
  if (reminders.length === 0) {
    return { replyText: "目前沒有已排程提醒。" };
  }

  return {
    replyText: reminders
      .map(
        (reminder, index) =>
          `${index + 1}. ${reminder.id} ${reminder.due_at_utc} ${reminder.message}`,
      )
      .join("\n"),
  };
}

async function cancelReminder(
  input: RouteInput,
  reminderId: string,
  nowUtc: string,
): Promise<RouteResult> {
  const cancelled = await input.repos.reminders.cancel(input.userId, reminderId, nowUtc);
  return { replyText: cancelled ? "已取消這個提醒。" : "找不到這個已排程提醒。" };
}

async function setTimezone(
  input: RouteInput,
  timezone: string,
  nowUtc: string,
): Promise<RouteResult> {
  const normalized = parseTimezone(timezone, input.userTimezone);
  if (!input.setUserTimezone) {
    return { replyText: "目前無法設定時區。" };
  }

  await input.setUserTimezone(input.userId, normalized, nowUtc);
  return { replyText: `已設定時區：${normalized}` };
}

async function clearRecentConversation(
  input: RouteInput,
  nowUtc: string,
): Promise<RouteResult> {
  if (!input.clearRecentConversation) {
    return { replyText: "目前無法清除近期對話。" };
  }

  await input.clearRecentConversation(input.userId, nowUtc);
