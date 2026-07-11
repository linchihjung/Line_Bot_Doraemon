import type { ReminderRepository } from "../db/repositories";

const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_BATCHES = 20;

export interface ReminderDependencies {
  reminders: Pick<
    ReminderRepository,
    "findDueUnsent" | "claimDueReminder" | "markReminderSent" | "releaseDueReminder"
  >;
  line: {
    push(userId: string, text: string): Promise<void>;
  };
  batchSize?: number;
  maxBatches?: number;
}

export interface ReminderProcessSummary {
  attempted: number;
  pushed: number;
  skipped: number;
  failed: number;
}

export async function processDueReminders(
  nowUtc: string,
  deps: ReminderDependencies,
): Promise<ReminderProcessSummary> {
  const batchSize = deps.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES;
  const summary: ReminderProcessSummary = {
    attempted: 0,
    pushed: 0,
    skipped: 0,
    failed: 0,
  };

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    const reminders = await deps.reminders.findDueUnsent(nowUtc, batchSize);
    if (reminders.length === 0) {
      break;
    }

    let retryableLeftInBatch = false;

    for (const reminder of reminders) {
      summary.attempted += 1;

      const claimed = await deps.reminders.claimDueReminder(reminder.id, nowUtc);
      if (!claimed) {
        summary.skipped += 1;
        continue;
      }

      try {
        await deps.line.push(reminder.user_id, reminder.message);
      } catch {
        await deps.reminders.releaseDueReminder(reminder.id, nowUtc);
        summary.failed += 1;
        retryableLeftInBatch = true;
        continue;
      }

      const markedSent = await deps.reminders.markReminderSent(reminder.id, nowUtc);
      if (markedSent) {
        summary.pushed += 1;
      } else {
        await deps.reminders.releaseDueReminder(reminder.id, nowUtc);
        summary.failed += 1;
        retryableLeftInBatch = true;
      }
    }

    if (reminders.length < batchSize || retryableLeftInBatch) {
      break;
    }
  }

  return summary;
}
