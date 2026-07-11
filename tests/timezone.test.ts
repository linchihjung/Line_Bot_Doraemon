import { describe, expect, it } from "vitest";
import { parseTimezone, toUtcIso } from "../src/timezone";

describe("timezone helpers", () => {
  it("uses the fallback when no timezone is provided", () => {
    expect(parseTimezone(undefined, "Asia/Taipei")).toBe("Asia/Taipei");
  });

  it("accepts an explicit supported timezone", () => {
    expect(parseTimezone("Asia/Taipei", "UTC")).toBe("Asia/Taipei");
  });

  it("rejects unsupported timezone names", () => {
    expect(() => parseTimezone("Mars/Base", "Asia/Taipei")).toThrow(
      "Unsupported timezone: Mars/Base",
    );
  });

  it("converts a local datetime across the UTC date boundary", () => {
    expect(toUtcIso("2026-07-11T00:30:00", "Asia/Taipei")).toBe(
      "2026-07-10T16:30:00.000Z",
    );
  });

  it("rejects rolled-over local dates", () => {
    expect(() => toUtcIso("2026-02-31T09:00:00", "Asia/Taipei")).toThrow(
      "Invalid local datetime: 2026-02-31T09:00:00",
    );
  });

  it("rejects out-of-range local times", () => {
    expect(() => toUtcIso("2026-07-11T25:00:00", "Asia/Taipei")).toThrow(
      "Invalid local datetime: 2026-07-11T25:00:00",
    );
  });
});
