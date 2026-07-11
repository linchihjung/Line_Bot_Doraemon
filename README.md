# LINE Bot Doraemon

一個部署在 Cloudflare Workers 上的 LINE 個人助理 Bot。它以 LINE 作為入口，提供日常問答、待辦、一次性提醒，以及需要明確指令才會保存的個人長期記憶。

這個專案的目標是「自己可長期維護、部署成本低、資料邊界清楚」。正式環境跑在 Cloudflare 上，所以 Mac mini 可以睡眠，家中網路也不需要固定 IP。

## Features

- LINE webhook 接收與回覆訊息
- Gemini-backed 一般問答與多輪短期上下文
- 使用者隔離的待辦、提醒、記憶與短期對話資料
- 明確指令才建立長期記憶，普通聊天不自動保存成記憶
- Cloudflare D1 儲存資料
- Cloudflare Cron 掃描到期提醒並透過 LINE Push Message API 推播
- LINE webhook HMAC 簽章驗證
- 敏感資訊偵測，避免把密碼、信用卡、身分證等內容寫入長期記憶
- 重複 webhook event id 去重，降低 LINE 重送造成的重複操作

## Architecture

```text
LINE Messaging API
        |
        v
Cloudflare Worker /webhook
   |       |       |
   |       |       +--> Gemini API
   |       +----------> Cloudflare D1
   +------------------> LINE Reply / Push API

Cloudflare Cron
        |
        v
Due reminder scan -> LINE Push API
```

The Worker validates all model-generated structured intents before writing to D1. Gemini can suggest an intent, but it cannot directly operate on the database.

## Tech Stack

- TypeScript
- Cloudflare Workers
- Cloudflare D1
- Cloudflare Cron Triggers
- Wrangler
- Vitest
- Zod
- LINE Messaging API
- Gemini API

## Repository Layout

```text
src/
  app.ts                    Worker entrypoint
  db/                       D1 migrations and repositories
  intent/                   command parsing and model intent validation
  line/                     LINE signature verification and API client
  llm/                      Gemini adapter
  reminders/                due reminder processor
  security/                 sensitive-content detection
tests/                      unit and integration tests
docs/superpowers/           design and implementation planning notes
```

## Requirements

- Node.js 20 or newer
- pnpm
- Wrangler logged in to Cloudflare
- A Cloudflare account with Workers and D1 enabled
- A LINE Messaging API channel
- A Gemini API key

## Local Setup

Install dependencies:

```bash
pnpm install
```

Create local development secrets. Wrangler reads `.dev.vars` during `wrangler dev`:

```bash
cp .env.example .dev.vars
```

Edit `.dev.vars` with real values:

```bash
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
GEMINI_API_KEY=...
```

Run checks:

```bash
pnpm test -- --run
pnpm run typecheck
```

Apply local D1 migrations:

```bash
pnpm run db:migration:local
```

Start the local Worker:

```bash
pnpm run dev
```

## Cloudflare Setup

Create the production D1 database:

```bash
wrangler d1 create LINE_ASSISTANT_DB
```

Copy the returned `database_id` into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "LINE_ASSISTANT_DB"
database_id = "<your-d1-database-id>"
migrations_dir = "src/db/migrations"
```

Apply production migrations:

```bash
wrangler d1 migrations apply LINE_ASSISTANT_DB --remote
```

Set production secrets:

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put GEMINI_API_KEY
```

Deploy:

```bash
pnpm run deploy
```

The Worker includes this Cron trigger:

```toml
[triggers]
crons = ["* * * * *"]
```

It checks due reminders about once per minute. Reminder times are stored as UTC in D1.

## LINE Developers Setup

1. Create or open a LINE Messaging API channel.
2. Copy the channel secret into `LINE_CHANNEL_SECRET`.
3. Issue a long-lived channel access token and save it as `LINE_CHANNEL_ACCESS_TOKEN`.
4. Deploy the Worker.
5. Set the LINE webhook URL:

   ```text
   https://<your-worker-domain>/webhook
   ```

6. Enable webhook usage in the LINE console.
7. Use LINE's webhook verification button after deployment.

## Smoke Test

After deployment, send messages to the LINE bot:

```text
幫我解釋量子糾纏
```

```text
記住 我喜歡無糖茶
列出記憶
```

```text
新增待辦 買牛奶
待辦列表
```

Use a complete future datetime for reminders:

```text
提醒 2026-07-11T09:00:00+08:00 繳電費
提醒列表
```

Sensitive long-term memory should be refused:

```text
記住 我的 password 是 hunter2
```

## Privacy and Safety Notes

- General chat stores only bounded short-term conversation messages.
- Long-term memories are created only from explicit memory commands.
- Sensitive content is refused for long-term memory storage.
- Every user-owned database operation is scoped by `user_id`.
- Duplicate LINE webhook event IDs are ignored.
- Reminder push is attempted before the reminder is marked sent; failed pushes remain retryable.
- Real secrets must be stored in `.dev.vars` locally or Cloudflare secrets in production. Do not commit them.
- Deleting all user data requires the exact confirmation phrase:

  ```text
  確認刪除所有資料
  ```

## Useful Commands

```bash
pnpm run dev
pnpm test -- --run
pnpm run typecheck
pnpm run db:migration:local
pnpm run deploy
```

## License

MIT
