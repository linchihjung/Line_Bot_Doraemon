const LINE_REPLY_ENDPOINT = "https://api.line.me/v2/bot/message/reply";
const LINE_PUSH_ENDPOINT = "https://api.line.me/v2/bot/message/push";

export class LineApiError extends Error {
  readonly status: number;
  readonly responseBody: string;

  constructor(status: number, responseBody: string) {
    super(`LINE API request failed with status ${status}`);
    this.name = "LineApiError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class LineClient {
  constructor(private readonly channelAccessToken: string) {}

  async reply(replyToken: string, text: string): Promise<void> {
    await this.post(LINE_REPLY_ENDPOINT, {
      replyToken,
      messages: [textMessage(text)],
    });
  }

  async push(userId: string, text: string): Promise<void> {
    await this.post(LINE_PUSH_ENDPOINT, {
      to: userId,
      messages: [textMessage(text)],
    });
  }

  private async post(endpoint: string, body: unknown): Promise<void> {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.channelAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new LineApiError(response.status, await response.text());
    }
  }
}

function textMessage(text: string): { type: "text"; text: string } {
  return { type: "text", text };
}
