import { z } from "zod";
import { parseTimezone } from "../timezone";

export const allowedIntents = [
  "chat",
  "create_todo",
  "list_todos",
  "complete_todo",
  "create_memory",
  "list_memories",
  "delete_memory",
  "create_reminder",
  "list_reminders",
  "cancel_reminder",
  "set_timezone",
] as const;

const nonEmptyString = z.string().trim().min(1);
const timezoneSchema = z.string().transform((timezone) => timezone.trim()).refine(
  (timezone) => {
    try {
      parseTimezone(timezone, timezone);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Unsupported timezone" },
);

export const intentSchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("chat"), text: nonEmptyString }).strict(),
  z.object({ intent: z.literal("create_todo"), content: nonEmptyString }).strict(),
  z.object({ intent: z.literal("list_todos") }).strict(),
  z.object({ intent: z.literal("complete_todo"), todo_id: nonEmptyString }).strict(),
  z.object({ intent: z.literal("create_memory"), content: nonEmptyString }).strict(),
  z.object({ intent: z.literal("list_memories") }).strict(),
  z.object({ intent: z.literal("delete_memory"), memory_id: nonEmptyString }).strict(),
  z
    .object({
      intent: z.literal("create_reminder"),
      content: nonEmptyString,
      due_at: z.string().datetime({ offset: true }),
    })
    .strict(),
  z.object({ intent: z.literal("list_reminders") }).strict(),
  z.object({ intent: z.literal("cancel_reminder"), reminder_id: nonEmptyString }).strict(),
  z.object({ intent: z.literal("set_timezone"), timezone: timezoneSchema }).strict(),
]);

export type Intent = z.infer<typeof intentSchema>;
export type IntentName = (typeof allowedIntents)[number];
