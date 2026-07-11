# LINE Bot Doraemon

Cloudflare Workers LINE personal assistant bot with D1 storage, one-time reminders, short-term chat context, explicit long-term memory commands, and Gemini-backed Q&A.

## Architecture

- LINE Messaging API sends webhook events to the Worker at `/webhook`.
- Cloudflare Worker verifies the LINE signature before processing events.
- Cloudflare D1 stores users, todos, reminders, memories, short-term conversation messages, and processed webhook event IDs.
- Cloudflare Cron scans due reminders and pushes LINE messages.
- Gemini handles general chat and constrained intent extraction; the Worker validates model output before any database write.

The production bot runs on Cloudflare. Your Mac mini can sleep, and your home network does not need a fixed IP.

## Requirements

- Node.js and pnpm/npm available locally.
- Wrangler authenticated to Cloudflare.
- A LINE Messaging API channel.
- A Gemini API key.

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

Run tests:

```bash
pnpm test -- --run
pnpm run typecheck
```

Apply the local D1 migration:

```bash
pnpm run db:migration:local
```

Start the local Worker:

```bash
pnpm run dev
```

## Cloudflare D1

Create the production D1 database:

```bash
wrangler d1 create LINE_ASSISTANT_DB
```

Copy the returned `database_id` into `wrangler.toml`, replacing:

```toml
database_id = "00000000-0000-0000-0000-000000000000"
```

Apply production migrations:

```bash
wrangler d1 migrations apply LINE_ASSISTANT_DB --remote
```

For local development, migrations are read from:

```text
src/db/migrations
```

## Cloudflare Secrets

Set production secrets with Wrangler. Do not commit real secret values.

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put GEMINI_API_KEY
```

## LINE Developers Setup

1. Create or open a LINE Messaging API channel.
2. Copy the channel secret into `LINE_CHANNEL_SECRET`.
3. Issue a long-lived channel access token and save it as `LINE_CHANNEL_ACCESS_TOKEN`.
4. Deploy the Worker.
5. Set the LINE webhook URL to:

```text
https://<your-worker-domain>/webhook
```

6. Enable webhook usage in the LINE console.
7. Use LINE's webhook verification button after deploy.

## Deploy

Deploy the Worker:

```bash
pnpm run deploy
```

The Worker includes a Cron trigger in `wrangler.toml`:

```toml
[triggers]
crons = ["* * * * *"]
```

This checks due reminders about once per minute. Reminder times are stored as UTC in D1.

## Smoke Test

After deployment:

1. In LINE Developers, verify the webhook URL.
2. Send a message to the bot:

```text
幫我解釋量子糾纏
```

3. Test explicit memory:

```text
記住 我喜歡無糖茶
列出記憶
```

4. Test a todo:

```text
新增待辦 買牛奶
待辦列表
```

5. Test a complete reminder datetime. Use a time about 5 minutes in the future:

```text
提醒 YYYY-MM-DDTHH:mm:ss+08:00 繳電費
提醒列表
```

6. Confirm sensitive data is refused:

```text
記住 我的 password 是 hunter2
```

## Operations Notes

- General chat stores only bounded short-term conversation messages.
- Long-term memories are created only from explicit memory commands.
- Sensitive content is refused for long-term memory storage.
- Duplicate LINE webhook event IDs are ignored.
- Reminder push is attempted before the reminder is marked sent; failed pushes remain retryable.
- All-user-data deletion requires the exact confirmation phrase:

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
