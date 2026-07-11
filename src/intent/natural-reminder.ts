import { toUtcIso } from "../timezone";

export interface NaturalReminderOptions {
  nowUtc: string;
  timezone: string;
}

export interface NaturalReminderResult {
  dueAtUtc: string;
  message: string;
}

const CHINESE_HOURS = new Map<string, number>([
  ["一", 1],
  ["二", 2],
  ["兩", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["七", 7],
  ["八", 8],
  ["九", 9],
  ["十", 10],
  ["十一", 11],
  ["十二", 12],
]);

const WEEKDAYS = new Map<string, number>([
  ["一", 1],
  ["二", 2],
  ["三", 3],
  ["四", 4],
  ["五", 5],
  ["六", 6],
  ["日", 0],
  ["天", 0],
]);

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
}

export function parseNaturalReminder(
  text: string,
  options: NaturalReminderOptions,
): NaturalReminderResult | undefined {
  const trimmed = text.trim();
  return parseRelativeReminder(trimmed, options) ?? parseCalendarReminder(trimmed, options);
}

export function needsNaturalReminderClarification(text: string): boolean {
  const trimmed = text.trim();
  return /^週末提醒我\s*.+$/.test(trimmed) || /^提醒\s+週末\s+.+$/.test(trimmed);
}

function parseRelativeReminder(
  text: string,
  options: NaturalReminderOptions,
): NaturalReminderResult | undefined {
  const match = /^(\d+)\s*(分鐘|小時)後提醒我\s*(.+)$/.exec(text);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unitMs = match[2] === "分鐘" ? 60_000 : 60 * 60_000;
  const message = normalizeMessage(match[3]);
  if (!Number.isFinite(amount) || amount <= 0 || !message) {
    return undefined;
  }

  return {
    dueAtUtc: new Date(new Date(options.nowUtc).getTime() + amount * unitMs).toISOString(),
    message,
  };
}

function parseCalendarReminder(
  text: string,
  options: NaturalReminderOptions,
): NaturalReminderResult | undefined {
  const suffixMatch = /^(.+?)提醒我\s*(.+)$/.exec(text);
  const prefixMatch = /^提醒\s+(.+?)\s+(.+)$/.exec(text);
  const timeText = suffixMatch?.[1]?.trim() ?? prefixMatch?.[1]?.trim();
  const message = normalizeMessage(suffixMatch?.[2] ?? prefixMatch?.[2]);
  if (!timeText || !message) {
    return undefined;
  }

  const timeMatch = /^(今天|明天|下週[一二三四五六日天])(早上|上午|中午|下午|晚上)?([零一二兩三四五六七八九十\d]{1,3})點$/.exec(
    timeText,
  );
  if (!timeMatch) {
    return undefined;
  }

  const date = resolveDate(timeMatch[1], options);
  const hour = resolveHour(timeMatch[3], timeMatch[2]);
  if (!date || hour === undefined) {
    return undefined;
  }

  const localDateTime = `${date.year}-${pad2(date.month)}-${pad2(date.day)}T${pad2(hour)}:00:00`;
  try {
    return {
      dueAtUtc: toUtcIso(localDateTime, options.timezone),
      message,
    };
  } catch {
    return undefined;
  }
}

function resolveDate(token: string, options: NaturalReminderOptions): LocalDateParts | undefined {
  const nowLocal = getLocalDateParts(new Date(options.nowUtc), options.timezone);
  const baseDate = new Date(Date.UTC(nowLocal.year, nowLocal.month - 1, nowLocal.day));

  if (token === "今天") {
    return addUtcDays(baseDate, 0);
  }

  if (token === "明天") {
    return addUtcDays(baseDate, 1);
  }

  const weekdayToken = /^下週([一二三四五六日天])$/.exec(token)?.[1];
  const targetWeekday = weekdayToken ? WEEKDAYS.get(weekdayToken) : undefined;
  if (targetWeekday === undefined) {
    return undefined;
  }

  const currentWeekday = baseDate.getUTCDay();
  const daysUntilNextWeekStart = ((1 - currentWeekday + 7) % 7) || 7;
  const daysFromMonday = targetWeekday === 0 ? 6 : targetWeekday - 1;
  return addUtcDays(baseDate, daysUntilNextWeekStart + daysFromMonday);
}

function resolveHour(value: string, period: string | undefined): number | undefined {
  const baseHour = /^\d+$/.test(value) ? Number(value) : CHINESE_HOURS.get(value);
  if (baseHour === undefined || baseHour < 0 || baseHour > 23) {
    return undefined;
  }

  if (period === "下午" || period === "晚上") {
    return baseHour < 12 ? baseHour + 12 : baseHour;
  }

  if (period === "中午") {
    return baseHour === 12 ? 12 : baseHour + 12;
  }

  return baseHour;
}

function normalizeMessage(value: string | undefined): string {
  return value?.trim().replace(/^[:：]\s*/, "") ?? "";
}

function getLocalDateParts(date: Date, timezone: string): LocalDateParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function addUtcDays(date: Date, days: number): LocalDateParts {
  const result = new Date(date.getTime() + days * 24 * 60 * 60_000);
  return {
    year: result.getUTCFullYear(),
    month: result.getUTCMonth() + 1,
    day: result.getUTCDate(),
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
