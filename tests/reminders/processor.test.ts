import { describe, expect, it, vi } from "vitest";
import type { ReminderRecord, ReminderRepository } from "../../src/db/repositories";
import { processDueReminders } from "../../src/reminders/processor";

const NOW = "2026-07-10T08:00:00.000Z";

describe("processDueReminders", () => {
  it("pushes one due unsent reminder and marks it sent after the push succeeds", async () => {
    const reminder = reminderRecord({ id: "reminder-1", user_id: "line-user-1" });
    const deps = createDeps({ reminders: [reminder] });

    const summary = await processDueReminders(NOW, deps);

    expect(summary).toEqual({ attempted: 1, pushed: 1, skipped: 0, failed: 0 });
    expect(deps.reminders.claimDueReminder).toHaveBeenCalledWith("reminder-1", NOW);
    expect(deps.line.push).toHaveBeenCalledWith("line-user-1", "繳電費");
    expect(deps.reminders.markReminderSent).toHaveBeenCalledWith("reminder-1", NOW);
    expect(deps.reminders.releaseDueReminder).not.toHaveBeenCalled();
  });

  it("leaves a reminder retryable when the LINE push fails and continues others", async () => {
    const first = reminderRecord({ id: "reminder-1", user_id: "line-user-1" });
    const second = reminderRecord({ id: "reminder-2", user_id: "line-user-2" });
    const deps = createDeps({ reminders: [first, second] });
    deps.line.push.mockRejectedValueOnce(new Error("LINE unavailable"));

    const summary = await processDueReminders(NOW, deps);

    expect(summary).toEqual({ attempted: 2, pushed: 1, skipped: 0, failed: 1 });
    expect(deps.line.push).toHaveBeenCalledTimes(2);
    expect(deps.reminders.claimDueReminder).toHaveBeenCalledTimes(2);
    expect(deps.reminders.releaseDueReminder).toHaveBeenCalledWith("reminder-1", NOW);
    expect(deps.reminders.markReminderSent).toHaveBeenCalledWith("reminder-2", NOW);
  });

  it("skips without pushing when the atomic claim loses", async () => {
    const reminder = reminderRecord({ id: "reminder-1", user_id: "line-user-1" });
    const deps = createDeps({ reminders: [reminder], claimResults: [false] });

    const summary = await processDueReminders(NOW, deps);

    expect(summary).toEqual({ attempted: 1, pushed: 0, skipped: 1, failed: 0 });
    expect(deps.line.push).not.toHaveBeenCalled();
    expect(deps.reminders.claimDueReminder).toHaveBeenCalledWith("reminder-1", NOW);
    expect(deps.reminders.markReminderSent).not.toHaveBeenCalled();
  });

  it("counts a reminder as failed when it cannot be marked sent after push", async () => {
    const reminder = reminderRecord({ id: "reminder-1", user_id: "line-user-1" });
    const deps = createDeps({ reminders: [reminder], markSentResults: [false] });

    const summary = await processDueReminders(NOW, deps);

    expect(summary).toEqual({ attempted: 1, pushed: 0, skipped: 0, failed: 1 });
    expect(deps.line.push).toHaveBeenCalledWith("line-user-1", "繳電費");
    expect(deps.reminders.markReminderSent).toHaveBeenCalledWith("reminder-1", NOW);
    expect(deps.reminders.releaseDueReminder).toHaveBeenCalledWith("reminder-1", NOW);
  });
});

function createDeps(options: {
  reminders: ReminderRecord[];
  claimResults?: boolean[];
  markSentResults?: boolean[];
}) {
  const claimResults = [...(options.claimResults ?? [])];
  const markSentResults = [...(options.markSentResults ?? [])];
  const reminders: Pick<
    ReminderRepository,
    "findDueUnsent" | "claimDueReminder" | "markReminderSent" | "releaseDueReminder"
  > = {
    findDueUnsent: vi.fn().mockResolvedValueOnce(options.reminders).mockResolvedValue([]),
    claimDueReminder: vi.fn(async () => claimResults.shift() ?? true),
    markReminderSent: vi.fn(async () => markSentResults.shift() ?? true),
    releaseDueReminder: vi.fn(async () => true),
  };
  const line = {
    push: vi.fn<(userId: string, text: string) => Promise<void>>().mockResolvedValue(undefined),
  };

  return { reminders, line };
}

function reminderRecord(overrides: Partial<ReminderRecord> = {}): ReminderRecord {
  return {
    id: "reminder-1",
    user_id: "line-user-1",
    message: "繳電費",
    due_at_utc: "2026-07-10T07:59:00.000Z",
    status: "scheduled",
    timezone: "Asia/Taipei",
    created_at: "2026-07-10T07:00:00.000Z",
    updated_at: "2026-07-10T07:00:00.000Z",
    sent_at_utc: null,
    cancelled_at_utc: null,
    ...overrides,
  };
}
