import { describe, expect, it } from "vitest";
import {
  needsNaturalReminderClarification,
  parseNaturalReminder,
} from "../../src/intent/natural-reminder";

const options = {
  nowUtc: "2026-07-10T08:00:00.000Z",
  timezone: "Asia/Taipei",
};

describe("parseNaturalReminder", () => {
  it("parses relative minute reminders", () => {
    expect(parseNaturalReminder("30分鐘後提醒我喝水", options)).toEqual({
      dueAtUtc: "2026-07-10T08:30:00.000Z",
      message: "喝水",
    });
  });

  it("parses relative hour reminders", () => {
    expect(parseNaturalReminder("2小時後提醒我休息", options)).toEqual({
      dueAtUtc: "2026-07-10T10:00:00.000Z",
      message: "休息",
    });
  });

  it("parses tomorrow morning Chinese hour reminders", () => {
    expect(parseNaturalReminder("明天早上九點提醒我開會", options)).toEqual({
      dueAtUtc: "2026-07-11T01:00:00.000Z",
      message: "開會",
    });
  });

  it("parses explicit reminder prefix with afternoon Chinese hour", () => {
    expect(parseNaturalReminder("提醒 明天下午三點 繳電費", options)).toEqual({
      dueAtUtc: "2026-07-11T07:00:00.000Z",
      message: "繳電費",
    });
  });

  it("parses next-week weekday reminders", () => {
    expect(parseNaturalReminder("下週一下午三點提醒我開會", options)).toEqual({
      dueAtUtc: "2026-07-13T07:00:00.000Z",
      message: "開會",
    });
  });

  it("returns undefined for unsupported vague reminders", () => {
    expect(parseNaturalReminder("週末提醒我整理房間", options)).toBeUndefined();
  });

  it("detects unsupported reminder-like text that needs clarification", () => {
    expect(needsNaturalReminderClarification("週末提醒我整理房間")).toBe(true);
    expect(needsNaturalReminderClarification("提醒 週末 整理房間")).toBe(true);
    expect(needsNaturalReminderClarification("請在週末提醒我整理房間")).toBe(true);
    expect(needsNaturalReminderClarification("幫我明天下班前提醒寄信")).toBe(false);
  });
});
