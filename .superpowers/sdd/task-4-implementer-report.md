## What you implemented

- Added `src/timezone.ts` with `parseTimezone(input, fallback)` and `toUtcIso(localDateTime, timezone)`.
  - Timezones are checked through explicit platform-supported timezone validation.
  - Local datetimes are converted to UTC ISO strings using `Intl.DateTimeFormat` timezone offsets, without relying on the machine timezone.
- Added `src/intent/schema.ts` with a strict Zod discriminated union for exactly these intents:
  - `chat`
  - `create_todo`
  - `list_todos`
  - `complete_todo`
  - `create_memory`
  - `list_memories`
  - `delete_memory`
  - `create_reminder`
  - `list_reminders`
  - `cancel_reminder`
  - `set_timezone`
- Added `src/llm/gemini.ts` with:
  - `GeminiClient.generate(input: GeminiInput): Promise<GeminiResult>`
  - Injectable `fetch` for tests.
  - Gemini endpoint construction from API key/model/base URL.
  - System instruction separating short-term conversation from long-term memory.
  - Markdown-wrapped JSON object normalization.
  - Plain text chat response handling.
  - `LlmUnavailableError` normalization for provider errors, request failures, timeouts, and invalid provider envelopes.

## What you tested and test results

- Added `tests/timezone.test.ts`
  - Fallback timezone behavior.
  - Explicit `Asia/Taipei` parsing.
  - Invalid timezone rejection.
  - Local `Asia/Taipei` datetime conversion across a UTC date boundary.
- Added `tests/intent/schema.test.ts`
  - Every allowed intent is accepted with a minimal valid payload.
  - Unknown intents are rejected.
  - Malformed reminder dates are rejected.
  - Unknown object fields are rejected.
- Added `tests/llm/gemini.test.ts`
  - Markdown-wrapped JSON object response is parsed and validated as an intent.
  - Plain text provider response is returned as chat.
  - Provider HTTP failure is normalized to `LlmUnavailableError`.

Final verification:

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec vitest --run tests/timezone.test.ts tests/intent/schema.test.ts tests/llm/gemini.test.ts

Test Files  3 passed (3)
Tests  11 passed (11)
```

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit

Exit code 0
```

## TDD Evidence

### RED: command run, relevant failing output before implementation, and why expected

Command:

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec vitest --run tests/timezone.test.ts tests/intent/schema.test.ts tests/llm/gemini.test.ts
```

Relevant failing output:

```text
FAIL  tests/timezone.test.ts [ tests/timezone.test.ts ]
Error: Failed to load url ../src/timezone ... Does the file exist?

FAIL  tests/intent/schema.test.ts [ tests/intent/schema.test.ts ]
Error: Failed to load url ../../src/intent/schema ... Does the file exist?

FAIL  tests/llm/gemini.test.ts [ tests/llm/gemini.test.ts ]
Error: Failed to load url ../../src/llm/gemini ... Does the file exist?

Test Files  3 failed (3)
```

Why expected:

- The tests were written before creating `src/timezone.ts`, `src/intent/schema.ts`, or `src/llm/gemini.ts`.
- The failure proved the new tests were being discovered and were exercising the missing Task 4 implementation surface.

Note:

- An earlier attempted RED run failed with "No test files found" because the first patch landed in the parent checkout instead of the Task 4 worktree. I corrected the files into `/Users/chihjung/Documents/Line_Bot_Doraemon/.worktrees/line-bot-assistant` and reran RED before writing production code.

### GREEN: command run and relevant passing output after implementation

Command:

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec vitest --run tests/timezone.test.ts tests/intent/schema.test.ts tests/llm/gemini.test.ts
```

Relevant passing output:

```text
✓ tests/intent/schema.test.ts (4 tests)
✓ tests/llm/gemini.test.ts (3 tests)
✓ tests/timezone.test.ts (4 tests)

Test Files  3 passed (3)
Tests  11 passed (11)
```

Typecheck command:

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit
```

Relevant passing output:

```text
Exit code 0
```

## Files changed

- `src/timezone.ts`
- `src/intent/schema.ts`
- `src/llm/gemini.ts`
- `tests/timezone.test.ts`
- `tests/intent/schema.test.ts`
- `tests/llm/gemini.test.ts`
- `.superpowers/sdd/task-4-implementer-report.md`

## Self-review findings

- No correctness issues found in the Task 4 implementation after focused tests and typecheck.
- The Gemini adapter validates JSON-object responses through `intentSchema`, so unknown intents and malformed reminder dates cannot cross the model boundary as accepted intents.
- The Gemini adapter returns plain text as chat when the provider output does not contain a JSON object.
- Provider HTTP failures, network-style failures, timeouts, empty responses, and invalid provider envelopes are normalized as `LlmUnavailableError`.
- The timezone conversion path does not depend on Node or Worker process timezone.

## Any issues or concerns

- The reminder intent schema accepts `due_at` as an ISO datetime with an explicit offset, matching the design example. Later routing/persistence work should convert any accepted reminder datetime to UTC ISO before writing D1, using the Task 4 timezone helper where the source is a local datetime plus timezone.
- The first patch attempt briefly created test files in the parent checkout. Those files were removed; only the pre-existing untracked parent `.pnpm-store/` remains outside this Task 4 worktree.

## Review Response

- Addressed Task 4 reviewer findings around the long-term memory boundary, provider-output normalization, and local datetime validation.
- Added tests that ordinary Gemini calls omit long-term memory snippets by default, while explicit `relevantMemories` are included.
- Added tests that malformed JSON object output and invalid JSON intent output reject with `LlmUnavailableError`.
- Added tests that invalid local dates and out-of-range local times are rejected.
- Changed `GeminiInput` to use optional `relevantMemories`; request bodies omit memory snippets unless explicitly provided.
- Normalized `JSON.parse` and Zod validation failures to `LlmUnavailableError`.
- Added timezone component range and round-trip validation before returning UTC ISO strings.
- Added `set_timezone` trimming through schema normalization.

Review-fix RED:

```text
Focused Task 4 tests failed before implementation:
- `set_timezone` whitespace was preserved instead of trimmed.
- invalid dates/times were accepted by `toUtcIso`.
- removing default memories exposed the old implementation reading `input.memories`.
```

Review-fix GREEN:

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec vitest --run tests/timezone.test.ts tests/intent/schema.test.ts tests/llm/gemini.test.ts

Test Files  3 passed (3)
Tests  17 passed (17)
```

```text
env CI=true PATH=/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin:/Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback:/usr/bin:/bin:/usr/sbin:/sbin /Users/chihjung/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm exec tsc --noEmit

Exit code 0
```
