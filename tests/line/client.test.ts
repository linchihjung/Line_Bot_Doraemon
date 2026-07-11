import { afterEach, describe, expect, it, vi } from "vitest";
import { LineApiError, LineClient } from "../../src/line/client";

describe("LINE client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a reply text message to the official endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LineClient("channel-token");

    await client.reply("reply-token", "hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/reply",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer channel-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          replyToken: "reply-token",
          messages: [{ type: "text", text: "hello" }],
        }),
      }),
    );
  });

  it("sends a push text message to the official endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LineClient("channel-token");

    await client.push("user-id", "hello");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          to: "user-id",
          messages: [{ type: "text", text: "hello" }],
        }),
      }),
    );
  });

  it("throws typed errors for non-2xx responses", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid reply token" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new LineClient("channel-token");

    const error = await client
      .reply("bad-token", "hello")
      .then(() => null)
      .catch((caughtError: unknown) => caughtError);

    expect(error).toBeInstanceOf(LineApiError);
    expect(error).toMatchObject({
      name: "LineApiError",
      status: 400,
      responseBody: '{"message":"Invalid reply token"}',
    });
  });
});
