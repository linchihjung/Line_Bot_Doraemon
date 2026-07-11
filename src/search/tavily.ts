const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESULTS = 5;

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchClient {
  search(query: string): Promise<WebSearchResult[]>;
}

export class WebSearchUnavailableError extends Error {
  constructor(message = "Web search provider is unavailable") {
    super(message);
    this.name = "WebSearchUnavailableError";
  }
}

export interface TavilySearchClientOptions {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxResults?: number;
}

export class TavilySearchClient implements WebSearchClient {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResults: number;

  constructor(options: TavilySearchClientOptions) {
    this.apiKey = options.apiKey;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  }

  async search(query: string): Promise<WebSearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(TAVILY_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          search_depth: "basic",
          topic: "general",
          max_results: this.maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new WebSearchUnavailableError(`Tavily request failed with ${response.status}`);
      }

      const payload = (await response.json()) as { results?: unknown };
      if (!Array.isArray(payload.results)) {
        throw new WebSearchUnavailableError("Tavily returned no results");
      }

      return payload.results
        .map(normalizeResult)
        .filter((result): result is WebSearchResult => result !== undefined);
    } catch (error) {
      if (error instanceof WebSearchUnavailableError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new WebSearchUnavailableError("Tavily request timed out");
      }

      if (error instanceof TypeError) {
        throw new WebSearchUnavailableError(`Tavily network request failed: ${error.message}`);
      }

      if (error instanceof SyntaxError) {
        throw new WebSearchUnavailableError("Tavily returned invalid JSON");
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeResult(value: unknown): WebSearchResult | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const result = value as { title?: unknown; url?: unknown; content?: unknown };
  if (
    typeof result.title !== "string" ||
    typeof result.url !== "string" ||
    typeof result.content !== "string"
  ) {
    return undefined;
  }

  return {
    title: result.title,
    url: result.url,
    snippet: result.content,
  };
}
