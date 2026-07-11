import { describe, expect, it, vi } from "vitest";
import { TavilySearchClient } from "../../src/search/tavily";

describe("TavilySearchClient", () => {
  it("queries Tavily and normalizes search results", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              title: "D1 docs",
              url: "https://developers.cloudflare.com/d1/",
              content: "Cloudflare D1 is a SQL database.",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const client = new TavilySearchClient({ apiKey: "test-key", fetch });

    await expect(client.search("Cloudflare D1 文件")).resolves.toEqual([
      {
        title: "D1 docs",
        url: "https://developers.cloudflare.com/d1/",
        snippet: "Cloudflare D1 is a SQL database.",
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.tavily.com/search",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
