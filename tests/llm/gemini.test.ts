import { describe, expect, it, vi } from "vitest";
import { GeminiClient, LlmUnavailableError } from "../../src/llm/gemini";

const NOW_UTC = "2026-07-11T01:30:00.000Z";

describe("GeminiClient", () => {
  it("normalizes markdown-wrapped JSON object responses into validated intents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: [
                      "```json",
                      JSON.stringify({
                        intent: "create_reminder",
                        content: "繳電費",
                        due_at: "2026-07-11T09:00:00+08:00",
                      }),
                      "```",
                    ].join("\n"),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "明天九點提醒我繳電費",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).resolves.toEqual({
      type: "intent",
      intent: {
        intent: "create_reminder",
        content: "繳電費",
        due_at: "2026-07-11T09:00:00+08:00",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/models/gemini-3.1-flash-lite:generateContent"),
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.systemInstruction.parts[0].text).toContain("你是哆啦A夢");
    expect(body.systemInstruction.parts[0].text).toContain("像哆啦A夢一樣");
    expect(body.systemInstruction.parts[0].text).toContain("short-term conversation");
    expect(body.systemInstruction.parts[0].text).toContain("long-term memory");
    expect(body.contents.at(-1).parts[0].text).toContain(
      "Current local datetime: 2026-07-11 09:30:00 (Asia/Taipei)",
    );
    expect(body.contents.at(-1).parts[0].text).toContain(
      "Current UTC datetime: 2026-07-11T01:30:00.000Z",
    );
    expect(body.contents.at(-1).parts[0].text).not.toContain("Long-term memories");
  });

  it("returns plain text for chat responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "量子糾纏是..." }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "幫我解釋量子糾纏",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).resolves.toEqual({ type: "chat", text: "量子糾纏是..." });
  });

  it("includes long-term memory snippets only when explicitly supplied", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "好的" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await client.generate({
      message: "推薦飲料",
      timezone: "Asia/Taipei",
      nowUtc: NOW_UTC,
      recentMessages: [],
      relevantMemories: ["使用者喜歡無糖茶"],
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.contents.at(-1).parts[0].text).toContain(
      "Relevant long-term memory snippets",
    );
    expect(body.contents.at(-1).parts[0].text).toContain("使用者喜歡無糖茶");
  });

  it("normalizes provider failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "hello",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("keeps safe fetch failure details for diagnostics", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "hello",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).rejects.toThrow("Gemini request failed: fetch failed");
  });

  it("does not call the configured fetch with the GeminiClient as this", async () => {
    const fetchMock = vi.fn(function (this: unknown) {
      if (this instanceof GeminiClient) {
        throw new TypeError("Illegal invocation");
      }

      return Promise.resolve(
        new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: "OK" }] } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "hello",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).resolves.toEqual({ type: "chat", text: "OK" });
  });

  it("normalizes malformed JSON object output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "```json\n{\"intent\":\n```" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "提醒我",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("normalizes invalid JSON intent output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify({ intent: "send_email", content: "hi" }) }],
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const client = new GeminiClient({ apiKey: "test-key", fetch: fetchMock });

    await expect(
      client.generate({
        message: "寄信",
        timezone: "Asia/Taipei",
        nowUtc: NOW_UTC,
        recentMessages: [],
      }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});
