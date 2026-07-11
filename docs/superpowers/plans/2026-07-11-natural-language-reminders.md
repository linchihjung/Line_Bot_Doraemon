# Natural Language Reminders Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add hybrid natural-language reminder creation for common Chinese reminder phrases, using deterministic parsing first and Gemini intent fallback second.

**Architecture:** Keep reminder creation inside the existing `routeMessage` flow. Add a focused parser module that converts common Chinese time phrases into UTC ISO datetimes using the user's timezone, and let unsupported reminder-like phrases fall through to the existing Gemini intent path. Gemini outputs remain validated through the existing intent schema and `createReminder` path.

**Tech Stack:** TypeScript, Cloudflare Workers-compatible `Intl`, existing timezone helper, Vitest.

## Global Constraints

- Do not add a paid API or new dependency.
- Deterministic parser runs before Gemini for supported Chinese time phrases.
- Gemini fallback may create reminders only through the existing validated `create_reminder` intent.
- Unsupported or ambiguous explicit reminder commands must ask for a clearer time instead of guessing.
- Reminder storage remains user-scoped and timezone-aware.

---

### Task 1: Add Deterministic Chinese Reminder Parser

**Files:**
- Create: `src/intent/natural-reminder.ts`
- Test: `tests/intent/natural-reminder.test.ts`

**Interfaces:**
- Consumes: `toUtcIso(localDateTime: string, timezone: string): string` from `src/timezone.ts`.
- Produces: `parseNaturalReminder(text: string, options: { nowUtc: string; timezone: string }): { dueAtUtc: string; message: string } | undefined`.

- [ ] **Step 1: Write failing parser tests**

```ts
import { describe, expect, it } from "vitest";
import { parseNaturalReminder } from "../../src/intent/natural-reminder";

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
});
```

- [ ] **Step 2: Verify parser tests fail**

Run: `./node_modules/.bin/vitest --run tests/intent/natural-reminder.test.ts --reporter verbose`

Expected: FAIL because `src/intent/natural-reminder.ts` does not exist.

- [ ] **Step 3: Implement parser**

Create `parseNaturalReminder` with:
- relative phrases: `N分鐘後提醒我X`, `N小時後提醒我X`
- date phrases: `今天`, `明天`, `下週一` through `下週日`
- day periods: `早上`, `上午`, `中午`, `下午`, `晚上`
- hours as Arabic numerals or common Chinese numerals from `一` to `十二`
- message extraction for both `...提醒我X` and `提醒 <time> X`

- [ ] **Step 4: Verify parser tests pass**

Run: `./node_modules/.bin/vitest --run tests/intent/natural-reminder.test.ts --reporter verbose`

Expected: all parser tests pass.

### Task 2: Integrate Parser Into Router Before Gemini

**Files:**
- Modify: `src/intent/router.ts`
- Test: `tests/intent/router.test.ts`

**Interfaces:**
- Consumes: `parseNaturalReminder(text, { nowUtc, timezone })`.
- Produces: route behavior that creates reminders without calling Gemini when the deterministic parser succeeds.

- [ ] **Step 1: Write failing router tests**

Add tests that:
- `明天早上九點提醒我開會` creates a reminder and does not call Gemini.
- `提醒 週末 整理房間` remains a clarification response and does not create a reminder.
- unsupported non-explicit reminder-like text falls through to Gemini, allowing existing validated intent fallback.

- [ ] **Step 2: Verify router tests fail**

Run: `./node_modules/.bin/vitest --run tests/intent/router.test.ts -t "natural language reminder" --reporter verbose`

Expected: FAIL because router has not yet integrated the parser.

- [ ] **Step 3: Implement router integration**

In `routeMessage`, after `nowUtc`, `timezone`, and `nextId` are computed but before `parseExplicitCommand`, call `parseNaturalReminder`. If it returns a result, call `createReminder(input, result.message, result.dueAtUtc, nowUtc, nextId)`.

Keep existing explicit ISO reminder handling unchanged.

- [ ] **Step 4: Verify router tests pass**

Run: `./node_modules/.bin/vitest --run tests/intent/router.test.ts --reporter verbose`

Expected: all router tests pass.

### Task 3: Full Verification, Deploy, Commit, Push

**Files:**
- Modify as needed: `src/intent/natural-reminder.ts`, `src/intent/router.ts`, `tests/intent/natural-reminder.test.ts`, `tests/intent/router.test.ts`

**Interfaces:**
- Produces: deployed Worker that supports hybrid natural-language reminders.

- [ ] **Step 1: Run full checks**

Run:

```bash
./node_modules/.bin/vitest --run
./node_modules/.bin/tsc --noEmit
```

Expected:
- 12 test files pass.
- All tests pass.
- TypeScript exits 0.

- [ ] **Step 2: Deploy**

Run: `pnpm run deploy`

Expected: Wrangler deploy succeeds and prints the Worker URL.

- [ ] **Step 3: Commit and push branch**

Run:

```bash
git add src/intent/natural-reminder.ts src/intent/router.ts tests/intent/natural-reminder.test.ts tests/intent/router.test.ts docs/superpowers/plans/2026-07-11-natural-language-reminders.md
git commit -m "feat: add hybrid natural language reminders"
git push origin codex/natural-language-reminders
```

Expected: commit and push succeed.

## Self-Review

- Spec coverage: deterministic parser, Gemini fallback through existing model intent path, validation, and unsupported clarification are covered.
- Placeholder scan: no TBD/TODO placeholders.
- Type consistency: `parseNaturalReminder` returns `dueAtUtc` and `message`, matching router reminder creation needs.
