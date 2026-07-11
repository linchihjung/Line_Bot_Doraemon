import { ZodError } from "zod";
import { intentSchema, type Intent } from "../intent/schema";

const DEFAULT_MODEL = "gemini-3.1-flash-lite";
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface GeminiInput {
  message: string;
  timezone: string;
  recentMessages: Array<{ role: "user" | "assistant"; content: string }>;
  relevantMemories?: string[];
}

export type GeminiResult =
  | { type: "chat"; text: string }
  | { type: "intent"; intent: Intent };

export interface GeminiClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class LlmUnavailableError extends Error {
  constructor(message = "LLM provider is unavailable") {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export class GeminiClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: GeminiClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch
      ? (input, init) => options.fetch!(input, init)
      : (input, init) => fetch(input, init);
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async generate(input: GeminiInput): Promise<GeminiResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(this.endpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestBody(input)),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LlmUnavailableError(`Gemini request failed with ${response.status}`);
      }

      const payload = await response.json();
      const text = extractGeminiText(payload);
      const jsonObject = extractJsonObject(text);

      if (!jsonObject) {
        return { type: "chat", text: text.trim() };
      }

      return { type: "intent", intent: intentSchema.parse(jsonObject) };
    } catch (error) {
      if (error instanceof LlmUnavailableError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LlmUnavailableError("Gemini request timed out");
      }

      if (error instanceof TypeError) {
        throw new LlmUnavailableError(`Gemini request failed: ${error.message}`);
      }

      if (error instanceof SyntaxError || error instanceof ZodError) {
        throw new LlmUnavailableError("Gemini returned invalid model output");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private endpoint(): string {
    const params = new URLSearchParams({ key: this.apiKey });
    return `${this.baseUrl}/models/${this.model}:generateContent?${params.toString()}`;
  }
}

function buildRequestBody(input: GeminiInput): unknown {
  const userContext = [
    `User timezone: ${input.timezone}`,
    ...(input.relevantMemories?.length
      ? [
          `Relevant long-term memory snippets:\n${input.relevantMemories.join("\n")}`,
        ]
      : []),
    `Message: ${input.message}`,
  ];

  return {
    systemInstruction: {
      parts: [{ text: buildSystemInstruction() }],
    },
    contents: [
      ...input.recentMessages.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      {
        role: "user",
        parts: [
          {
            text: userContext.join("\n\n"),
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };
}

function buildSystemInstruction(): string {
  return [
    "You are a LINE personal assistant.",
    "Use short-term conversation as the default context for immediate chat.",
    "Use supplied long-term memory snippets only when the caller explicitly provides them and they are relevant; never invent memories.",
    "For ordinary chat, return plain text only.",
    "For command-like input, return exactly one JSON object matching the allowed intent schema.",
    "Allowed intents: chat, create_todo, list_todos, complete_todo, create_memory, list_memories, delete_memory, create_reminder, list_reminders, cancel_reminder, set_timezone.",
    "Reminder due_at values must be ISO 8601 datetimes with an explicit offset.",
  ].join(" ");
}

function extractGeminiText(payload: unknown): string {
  const text = geminiResponseSchema(payload);

  if (!text.trim()) {
    throw new LlmUnavailableError("Gemini returned an empty response");
  }

  return text;
}

function geminiResponseSchema(payload: unknown): string {
  if (!payload || typeof payload !== "object") {
    throw new LlmUnavailableError("Gemini returned an invalid response");
  }

  const candidates = (payload as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) {
    throw new LlmUnavailableError("Gemini returned no candidates");
  }

  const parts = (candidates[0] as { content?: { parts?: unknown[] } } | undefined)?.content
    ?.parts;
  if (!Array.isArray(parts)) {
    throw new LlmUnavailableError("Gemini returned no content");
  }

  return parts
    .map((part) => ((part as { text?: unknown }).text))
    .filter((text): text is string => typeof text === "string")
    .join("");
}

function extractJsonObject(text: string): unknown | undefined {
  const trimmed = text.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    if (/^```(?:json)?/i.test(trimmed) || firstBrace !== -1 || lastBrace !== -1) {
      throw new LlmUnavailableError("Gemini returned malformed JSON");
    }

    return undefined;
  }

  return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1));
}
