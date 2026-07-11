# Contributing

This project is primarily maintained as a personal self-hosted LINE assistant. Contributions are welcome when they keep the bot simple, private-by-default, and easy to deploy on Cloudflare.

## Development Setup

```bash
pnpm install
cp .env.example .dev.vars
pnpm test -- --run
pnpm run typecheck
```

Fill `.dev.vars` with local development secrets. Never commit real LINE, Cloudflare, or Gemini credentials.

## Before Opening a PR

Please run:

```bash
pnpm test -- --run
pnpm run typecheck
```

For changes that touch reminders, database access, memory, or LINE webhook handling, include tests for user isolation and failure behavior.

## Design Principles

- Keep the production path deployable on Cloudflare Workers.
- Keep user data scoped by LINE user ID.
- Do not store sensitive content in long-term memory.
- Do not let model output directly mutate the database without validation.
- Prefer explicit commands for persistent actions.
- Keep first-version reminder behavior simple: push once, then mark sent.
