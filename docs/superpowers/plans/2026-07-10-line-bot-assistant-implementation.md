# LINE Bot 個人助理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個部署在 Cloudflare Workers 的 LINE 個人助理，支援一般問答、待辦、個人記憶與一次性提醒，並隔離每位使用者的資料。

**Architecture:** LINE Messaging API 將 webhook 傳給 Cloudflare Worker。Worker 驗證簽章、辨識明確指令或呼叫 Gemini 取得結構化意圖，再由 repository 寫入 Cloudflare D1；Cloudflare Cron 定期查詢到期提醒並透過 LINE Push Message API 推播。Mac mini 只作為開發環境，不是第一版的執行依賴。

**Tech Stack:** TypeScript, Cloudflare Workers, Wrangler, Cloudflare D1, Cloudflare Cron Triggers, Vitest, Zod, LINE Messaging API, Gemini API。

## Global Constraints

- 第一版一般問答只保留最近幾輪對話，不長期保存完整聊天紀錄。
- 明確記憶指令一定執行；自然對話只有在意圖非常明確時才建議儲存。
- 一般問答、待辦、提醒與長期記憶必須分開處理。
- 每張使用者資料表都必須以 `user_id` 限制查詢與寫入。
- 提醒時間依每位使用者時區計算，預設為 `Asia/Taipei`，資料庫儲存 UTC。
- 第一版提醒只推播一次並標記為已推播；不做重複提醒、完成確認或延後提醒。
- 敏感資訊不得寫入長期記憶或錯誤紀錄。
- 模型不得直接操作資料庫；Worker 必須驗證模型輸出後才執行資料操作。
- LINE token、LINE secret、Gemini API key 只能透過 Cloudflare secrets 提供。
- Mac mini 睡眠或家中網路沒有固定 IP 不得影響雲端 webhook 與提醒。

---

## File Map

### Project and configuration

- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/package.json` - scripts and runtime dependencies.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tsconfig.json` - strict TypeScript configuration.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/wrangler.toml` - Worker entrypoint, D1 binding, and Cron trigger.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/vitest.config.ts` - unit test environment.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/.gitignore` - local secrets, Wrangler state, and build output.

### Runtime and domain code

- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/types.ts` - environment, domain, and provider interfaces.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/security/sensitive-content.ts` - conservative sensitive-content detection.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/line/signature.ts` - LINE webhook HMAC verification.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/line/client.ts` - LINE reply and push message clients.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/llm/gemini.ts` - Gemini request and normalized response handling.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/intent/schema.ts` - Zod schema for model intent output.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/intent/router.ts` - explicit command parsing and model intent routing.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/timezone.ts` - timezone parsing and UTC conversion.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/db/migrations/0001_initial.sql` - D1 schema and indexes.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/db/repositories.ts` - user-scoped D1 queries.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/reminders/processor.ts` - idempotent due-reminder scanning and push flow.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/src/app.ts` - dependency composition, webhook handling, and scheduled handling.

### Tests and documentation

- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/security/sensitive-content.test.ts` - sensitive-content cases.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/line/signature.test.ts` - valid, invalid, and malformed signatures.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/timezone.test.ts` - timezone and DST conversion cases.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/intent/router.test.ts` - explicit commands and ambiguous natural language.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/reminders/processor.test.ts` - one-time push and retry behavior.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/tests/app.test.ts` - webhook routing and user isolation integration tests.
- Create: `/Users/chihjung/Documents/Line_Bot_Doraemon/README.md` - local setup, Cloudflare setup, secrets, migration, and LINE configuration.

---

## Task 1: Scaffold the Worker project

**Files:** Create the project and configuration files listed in the project/configuration section above.

**Interfaces:** The Worker entrypoint must export a default object with `fetch(request, env, ctx)` and `scheduled(controller, env, ctx)` methods. `Env` is defined in `src/types.ts` and includes `DB: D1Database`, `LINE_CHANNEL_SECRET: string`, `LINE_CHANNEL_ACCESS_TOKEN: string`, and `GEMINI_API_KEY: string`.

- [ ] **Step 1: Write the project smoke test**

Create `tests/app.test.ts` with this initial test:

```ts
import { describe, expect, it } from "vitest";
import worker from "../src/app";

describe("worker", () => {
  it("exports fetch and scheduled handlers", () => {
    expect(typeof worker.fetch).toBe("function");
    expect(typeof worker.scheduled).toBe("function");
  });
});
```

- [ ] **Step 2: Run the smoke test and verify the expected failure**

Run: `npm test -- --run tests/app.test.ts`

Expected: FAIL because the project files and `src/app.ts` do not exist yet.

- [ ] **Step 3: Add package and TypeScript configuration**

Use scripts `dev: wrangler dev`, `test: vitest`, `typecheck: tsc --noEmit`, `db:migration:local: wrangler d1 migrations apply LINE_ASSISTANT_DB --local`, and `deploy: wrangler deploy`. Add runtime dependencies `zod` and dev dependencies `@cloudflare/workers-types`, `typescript`, `vitest`, and `wrangler`.

Set TypeScript to strict mode, target ES2022, module ESNext, moduleResolution Bundler, and include `src/**/*.ts`, `tests/**/*.ts`, and `worker-configuration.d.ts`.

- [ ] **Step 4: Add the initial Worker shell and environment types**

Define:

```ts
export interface Env {
  DB: D1Database;
  LINE_CHANNEL_SECRET: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  GEMINI_API_KEY: string;
}
```

Export a Worker shell from `src/app.ts` with `fetch` returning `404` for non-POST `/webhook` requests and `scheduled` returning a resolved promise until the reminder processor is added.

- [ ] **Step 5: Run the smoke test and static checks**

Run: `npm test -- --run tests/app.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit the scaffold**

Run:

```bash
git add package.json tsconfig.json wrangler.toml vitest.config.ts .gitignore src/types.ts src/app.ts tests/app.test.ts
git commit -m "chore: scaffold line assistant worker"
```

## Task 2: Add the D1 schema and user-scoped repositories

**Files:** Create `src/db/migrations/0001_initial.sql`, `src/db/repositories.ts`, and repository tests in `tests/app.test.ts` or a new `tests/db/repositories.test.ts`.

**Interfaces:** `UserRepository`, `TodoRepository`, `ReminderRepository`, `MemoryRepository`, and `ConversationRepository` must accept `userId` for every user-owned operation. The reminder repository must expose `findDueUnsent(nowUtc: string, limit: number)` and an atomic claim/update operation that only changes rows still marked unsent.

- [ ] **Step 1: Write failing repository tests**

Test that a reminder query includes `user_id` and that a completed or already-pushed reminder is excluded. Test that memory lookup for `user-a` cannot return a row belonging to `user-b`.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `npm test -- --run tests/db/repositories.test.ts`

Expected: FAIL because the migration and repository methods do not exist.

- [ ] **Step 3: Create the D1 migration**

Create tables `users`, `todos`, `reminders`, `memories`, `conversation_messages`, and `processed_events`. Add foreign keys, status checks, `created_at`/`updated_at` fields, indexes on `(user_id, status)`, `(status, due_at_utc)`, and a unique `event_id` for webhook idempotency.

- [ ] **Step 4: Implement repository methods**

Implement parameterized D1 queries for user upsert, todos, memories, recent conversation messages, reminder creation/list/cancel, due reminder selection, event deduplication, and atomic reminder status update. No method may construct SQL with message text or user IDs interpolated into the query string.

- [ ] **Step 5: Run repository tests and typecheck**

Run: `npm test -- --run tests/db/repositories.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the database layer**

```bash
git add src/db/migrations/0001_initial.sql src/db/repositories.ts tests/db/repositories.test.ts
git commit -m "feat: add user-scoped d1 repositories"
```

## Task 3: Implement security and LINE boundary clients

**Files:** Create `src/security/sensitive-content.ts`, `src/line/signature.ts`, `src/line/client.ts`, and their tests.

**Interfaces:** `isSensitiveContent(text: string): boolean`, `verifyLineSignature(body: ArrayBuffer, signature: string, secret: string): Promise<boolean>`, `LineClient.reply(replyToken: string, text: string): Promise<void>`, and `LineClient.push(userId: string, text: string): Promise<void>`.

- [ ] **Step 1: Write failing security and client tests**

Cover password/card/identity-number patterns, normal messages, exact HMAC verification, altered body, altered signature, missing signature, and LINE client non-2xx responses.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/security/sensitive-content.test.ts tests/line/signature.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement conservative sensitive-content detection**

Return true for common password phrases, card-like digit groups, and Taiwan ID-like patterns while allowing ordinary numbers and dates. This is a warning gate, not a claim of perfect classification.

- [ ] **Step 4: Implement LINE signature verification**

Compute HMAC-SHA256 over the raw request body using `LINE_CHANNEL_SECRET`, base64 encode it, and compare in constant time. Read the request body exactly once in the webhook handler and pass its bytes to the verifier.

- [ ] **Step 5: Implement LINE API client**

Use `https://api.line.me/v2/bot/message/reply` and `/push`, send `Authorization: Bearer <token>`, parse non-2xx responses into typed errors, and send one text message per call.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- --run tests/security/sensitive-content.test.ts tests/line/signature.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the boundary layer**

```bash
git add src/security src/line tests/security tests/line
git commit -m "feat: add line authentication and messaging clients"
```

## Task 4: Add timezone conversion, intent schema, and Gemini adapter

**Files:** Create `src/timezone.ts`, `src/intent/schema.ts`, `src/llm/gemini.ts`, and tests for timezone and schema/model normalization.

**Interfaces:** `parseTimezone(input: string | undefined, fallback: string): string`, `toUtcIso(localDateTime: string, timezone: string): string`, `intentSchema`, and `GeminiClient.generate(input: GeminiInput): Promise<GeminiResult>`.

- [ ] **Step 1: Write failing timezone and Gemini normalization tests**

Cover `Asia/Taipei`, a UTC conversion across midnight, invalid timezone, and a model response that contains a JSON object wrapped in markdown. Reject unknown intents and malformed reminder dates.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/timezone.test.ts tests/llm/gemini.test.ts`

Expected: FAIL because the modules do not exist.

- [ ] **Step 3: Implement timezone handling**

Use the platform `Intl.DateTimeFormat` APIs and an explicit supported-timezone check. Convert confirmed local date/time plus timezone to a UTC ISO string before persistence. Never use the Worker machine timezone.

- [ ] **Step 4: Define and validate the intent schema**

Allow exactly these intents: `chat`, `create_todo`, `list_todos`, `complete_todo`, `create_memory`, `list_memories`, `delete_memory`, `create_reminder`, `list_reminders`, `cancel_reminder`, and `set_timezone`. Require only the fields needed by each intent and reject unknown keys where practical.

- [ ] **Step 5: Implement the Gemini adapter**

Call the configured Gemini endpoint with a system instruction that separates short-term conversation from long-term memory, asks for the intent schema for command-like input, and returns plain text for `chat`. Apply request timeout handling and normalize provider errors to a local `LlmUnavailableError`.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- --run tests/timezone.test.ts tests/llm/gemini.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit model and time handling**

```bash
git add src/timezone.ts src/intent/schema.ts src/llm src/intent tests/timezone.test.ts tests/llm tests/intent
git commit -m "feat: add intent validation and gemini adapter"
```

## Task 5: Implement explicit commands and safe intent routing

**Files:** Create `src/intent/router.ts` and `tests/intent/router.test.ts`.

**Interfaces:** `routeMessage(input: RouteInput): Promise<RouteResult>`, where `RouteInput` includes `userId`, `text`, `now`, `userTimezone`, repository dependencies, and a Gemini client; `RouteResult` includes `replyText` and any database side effects already validated by the router.

- [ ] **Step 1: Write failing routing tests**

Test explicit memory, todo, reminder, list, delete, and timezone commands. Test that an ambiguous statement such as “最近好累” becomes chat and does not write memory. Test that a sensitive explicit memory request returns a warning and performs no write.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/intent/router.test.ts`

Expected: FAIL because the router does not exist.

- [ ] **Step 3: Implement explicit command parsing**

Parse stable Traditional Chinese command patterns before calling Gemini. For reminders, require a complete date/time after applying the user timezone; return a clarification question when it is incomplete. For memory writes, require explicit verbs such as `記住` or a confirmed response to a memory suggestion.

- [ ] **Step 4: Implement natural-language routing**

Send only the minimum recent context to Gemini. For `chat`, return the model text without database writes except bounded short-term conversation messages. For structured intents, validate with `intentSchema`, run the corresponding user-scoped repository operation, and generate a concise confirmation.

- [ ] **Step 5: Add deletion and clearing commands**

Implement scoped deletion for a named memory, clearing recent conversation, and deleting all user data only after an explicit confirmation phrase. Never allow a model-generated request alone to perform destructive all-data deletion.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- --run tests/intent/router.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit routing behavior**

```bash
git add src/intent/router.ts tests/intent/router.test.ts
git commit -m "feat: route assistant commands and chat"
```

## Task 6: Implement webhook and scheduled reminder handling

**Files:** Modify `src/app.ts`; create `src/reminders/processor.ts` and `tests/reminders/processor.test.ts`; complete `tests/app.test.ts`.

**Interfaces:** `processDueReminders(nowUtc: string, deps: ReminderDependencies): Promise<ReminderProcessSummary>` and Worker handlers using the `Env` interface.

- [ ] **Step 1: Write failing reminder processor and webhook tests**

Test that one due unsent reminder is pushed and marked sent, already-sent reminders are skipped, a push failure leaves the reminder retryable, duplicate webhook event IDs are ignored, invalid signatures return `401`, and each webhook uses the sender's `line_user_id` when reading/writing data.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run tests/reminders/processor.test.ts tests/app.test.ts`

Expected: FAIL because the processor and complete handlers do not exist.

- [ ] **Step 3: Implement the idempotent reminder processor**

Query due unsent reminders in bounded batches. Attempt the LINE push first, then atomically mark the row as pushed only if it is still unsent. On push failure, keep the row unsent and continue processing other reminders. Return counts for attempted, pushed, skipped, and failed reminders.

- [ ] **Step 4: Implement the webhook handler**

Accept only `POST /webhook`, read raw bytes once, verify the LINE signature, parse events, ignore unsupported event types, deduplicate event IDs, route text messages, and reply using the event reply token. Return `200` after valid processing and a safe error response for failures.

- [ ] **Step 5: Implement the scheduled handler**

Call `processDueReminders` with the current UTC time from the Worker event. Do not depend on Mac mini availability, local files, or local timezone settings.

- [ ] **Step 6: Run tests and typecheck**

Run: `npm test -- --run tests/reminders/processor.test.ts tests/app.test.ts`

Expected: PASS.

Run: `npm run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the Worker workflow**

```bash
git add src/app.ts src/reminders/processor.ts tests/app.test.ts tests/reminders/processor.test.ts
git commit -m "feat: handle line webhooks and scheduled reminders"
```

## Task 7: Configure local D1, Cron, deployment, and operational documentation

**Files:** Modify `wrangler.toml`; create or modify `README.md`; add deployment smoke-test instructions.

**Interfaces:** Local development must run with `wrangler dev`, local D1 migration must run with the documented command, and production secrets must be set with `wrangler secret put`.

- [ ] **Step 1: Add Worker and D1 configuration**

Configure the Worker name, `main = "src/app.ts"`, compatibility date, D1 binding `DB` to database name `LINE_ASSISTANT_DB`, migration directory, and one Cron trigger that runs at a practical interval such as every minute.

- [ ] **Step 2: Apply the local migration**

Run: `npm run db:migration:local`

Expected: Wrangler creates the local D1 tables without SQL errors.

- [ ] **Step 3: Document setup and secrets**

Document LINE Developers channel setup, webhook URL `/webhook`, webhook signature secret, Gemini API key, `wrangler secret put LINE_CHANNEL_SECRET`, `wrangler secret put LINE_CHANNEL_ACCESS_TOKEN`, `wrangler secret put GEMINI_API_KEY`, local migration, deployment, and the fact that the Mac mini and fixed IP are not required.

- [ ] **Step 4: Run the complete verification suite**

Run: `npm test -- --run`

Expected: all unit and integration tests PASS.

Run: `npm run typecheck`

Expected: PASS.

Run: `npm run db:migration:local`

Expected: PASS or a documented no-op if the migration is already applied.

- [ ] **Step 5: Commit deployment configuration and docs**

```bash
git add wrangler.toml README.md package.json
git commit -m "docs: add local and cloudflare deployment setup"
```

## Self-Review Checklist

- Spec coverage: Tasks 1 and 7 cover the Cloudflare-first deployment and Mac mini independence; Task 2 covers D1 and user isolation; Task 3 covers LINE authentication, push/reply, and sensitive content; Task 4 covers Gemini, structured intents, recent context, and timezones; Task 5 covers chat, todos, memories, reminders, and destructive-action confirmation; Task 6 covers webhook idempotency, Cron, one-time push, and retry behavior.
- Placeholder scan: each task names files, interfaces, commands, and expected test outcomes instead of relying on vague placeholder instructions.
- Type consistency: `Env`, `LineClient`, `GeminiClient`, `RouteInput`, `RouteResult`, and `processDueReminders` are introduced before their consumers and use the same names throughout.
- Risk remaining for implementation: Gemini free-tier availability and exact model endpoint behavior should be verified against current provider documentation when the adapter is implemented; tests must mock the provider and must not require a paid API call.
