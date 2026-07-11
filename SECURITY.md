# Security Policy

## Supported Versions

This repository currently supports the latest code on `main` and active feature branches.

## Reporting a Vulnerability

If you find a vulnerability, please open a private report through GitHub Security Advisories when available, or contact the repository owner directly.

Please include:

- What data or action may be affected
- Steps to reproduce
- Expected impact
- Any relevant logs with secrets removed

## Secret Handling

Never commit:

- `.dev.vars`
- `.env`
- LINE channel secrets or access tokens
- Gemini API keys
- Cloudflare API tokens

Production secrets should be stored with:

```bash
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put GEMINI_API_KEY
```

## Security Boundaries

- LINE webhook requests must pass HMAC signature verification.
- User-owned D1 operations must be scoped by `user_id`.
- Gemini output must be validated before any database write.
- Long-term memories require explicit user intent.
- Sensitive content must not be saved into long-term memory or detailed error logs.
