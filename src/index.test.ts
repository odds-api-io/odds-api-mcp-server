import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must run before any module evaluation (vi.hoisted is lifted above imports)
vi.hoisted(() => {
  process.env.ODDS_API_KEY = "test-api-key";
});

// Mock the MCP SDK so module-level server setup doesn't fail
vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  class MockServer {
    setRequestHandler = vi.fn();
    connect = vi.fn();
  }
  return { Server: MockServer };
});
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class MockTransport {}
  return { StdioServerTransport: MockTransport };
});
vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  CallToolRequestSchema: Symbol("CallToolRequestSchema"),
  ListToolsRequestSchema: Symbol("ListToolsRequestSchema"),
  ListResourcesRequestSchema: Symbol("ListResourcesRequestSchema"),
  ReadResourceRequestSchema: Symbol("ReadResourceRequestSchema"),
}));

import { tools, toolMap, apiRequest, jsonResponse, textResponse, errorResponse } from "./index.js";

// ── Test Helpers ─────────────────────────────────────────────────────────────

function mockFetchJson(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchText(text: string, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  });
}

// ── Tool Registry ────────────────────────────────────────────────────────────

describe("Tool Registry", () => {
  const EXPECTED_TOOLS = [
    "get_sports",
    "get_bookmakers",
    "get_selected_bookmakers",
    "select_bookmakers",
    "clear_selected_bookmakers",
    "get_leagues",
    "get_events",
    "get_event",
    "get_live_events",
    "search_events",
    "get_odds",
    "get_multi_odds",
    "get_odds_movements",
    "get_updated_odds",
    "get_historical_events",
    "get_historical_odds",
    "get_value_bets",
    "get_arbitrage_bets",
    "get_participants",
    "get_participant",
    "get_documentation",
  ];

  it("has all 21 tools registered", () => {
    expect(tools).toHaveLength(21);
  });

  it("has no duplicate tool names", () => {
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(EXPECTED_TOOLS)("includes tool: %s", (name) => {
    expect(toolMap.has(name)).toBe(true);
  });

  it("every tool has a non-empty description", () => {
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });

  it("every tool has a valid inputSchema", () => {
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.inputSchema).toHaveProperty("properties");
      expect(tool.inputSchema).toHaveProperty("required");
      expect(Array.isArray(tool.inputSchema.required)).toBe(true);
    }
  });

  it("every required field exists in properties", () => {
    for (const tool of tools) {
      for (const field of tool.inputSchema.required) {
        expect(tool.inputSchema.properties).toHaveProperty(field);
      }
    }
  });

  it("toolMap provides O(1) lookup for all tools", () => {
    expect(toolMap.size).toBe(tools.length);
    for (const tool of tools) {
      expect(toolMap.get(tool.name)).toBe(tool);
    }
  });
});

// ── Required Parameters ──────────────────────────────────────────────────────

describe("Tool Schemas - Required Parameters", () => {
  const cases: Array<[string, string[]]> = [
    ["get_sports", []],
    ["get_bookmakers", []],
    ["get_selected_bookmakers", []],
    ["select_bookmakers", ["bookmakers"]],
    ["clear_selected_bookmakers", []],
    ["get_leagues", ["sport"]],
    ["get_events", ["sport"]],
    ["get_event", ["id"]],
    ["get_live_events", []],
    ["search_events", ["query"]],
    ["get_odds", ["eventId", "bookmakers"]],
    ["get_multi_odds", ["eventIds", "bookmakers"]],
    ["get_odds_movements", ["eventId", "bookmaker", "market"]],
    ["get_updated_odds", ["since", "bookmaker", "sport"]],
    ["get_historical_events", ["sport", "league", "from", "to"]],
    ["get_historical_odds", ["eventId", "bookmakers"]],
    ["get_value_bets", ["bookmaker"]],
    ["get_arbitrage_bets", ["bookmakers"]],
    ["get_participants", ["sport"]],
    ["get_participant", ["id"]],
    ["get_documentation", []],
  ];

  it.each(cases)("%s requires %j", (name, required) => {
    const tool = toolMap.get(name)!;
    expect(tool.inputSchema.required).toEqual(required);
  });
});

// ── Response Helpers ─────────────────────────────────────────────────────────

describe("Response Helpers", () => {
  it("jsonResponse wraps data as pretty-printed JSON text", () => {
    const result = jsonResponse({ foo: "bar" });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar" });
    expect(result.content[0].text).toContain("\n"); // pretty-printed
  });

  it("textResponse wraps raw text", () => {
    const result = textResponse("hello world");
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe("hello world");
  });

  it("errorResponse includes isError flag", () => {
    const result = errorResponse("something broke");
    expect(result.content[0].text).toBe("Error: something broke");
    expect(result.isError).toBe(true);
  });
});

// ── API Client ───────────────────────────────────────────────────────────────

describe("apiRequest", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("builds URL with endpoint and API key", async () => {
    const fetchMock = mockFetchJson({ ok: true });
    globalThis.fetch = fetchMock;

    await apiRequest("/sports");

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/sports");
    expect(calledUrl.searchParams.get("apiKey")).toBe("test-api-key");
  });

  it("appends query params to URL", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await apiRequest("/events", { sport: "football", league: "epl" });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.get("league")).toBe("epl");
  });

  it("filters out undefined params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await apiRequest("/events", { sport: "football", league: undefined });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.has("league")).toBe(false);
  });

  it("converts numeric params to strings", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await apiRequest("/events", { sport: "football", limit: 10, skip: 0 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("limit")).toBe("10");
    expect(calledUrl.searchParams.get("skip")).toBe("0");
  });

  it("converts boolean true to string", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await apiRequest("/leagues", { sport: "football", all: true });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("all")).toBe("true");
  });

  it("uses GET method by default", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;

    await apiRequest("/sports");

    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "GET" });
  });

  it("supports PUT method", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;

    await apiRequest("/bookmakers/selected/clear", {}, "PUT");

    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "PUT" });
  });

  it("throws on non-OK response", async () => {
    globalThis.fetch = mockFetchJson({ error: "not found" }, 404);

    await expect(apiRequest("/events/999999")).rejects.toThrow("API error 404");
  });
});

// ── Tool Handlers ────────────────────────────────────────────────────────────

describe("Tool Handlers", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("get_sports calls /sports", async () => {
    const mockData = [{ name: "Football", slug: "football" }];
    const fetchMock = mockFetchJson(mockData);
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("get_sports")!.handler({});

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/sports");
    expect(JSON.parse(result.content[0].text)).toEqual(mockData);
  });

  it("get_events passes all optional params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_events")!.handler({
      sport: "football",
      league: "england-premier-league",
      participantId: 38,
      status: "pending,live",
      from: "2025-01-01T00:00:00Z",
      to: "2025-01-31T23:59:59Z",
      bookmaker: "Bet365",
      limit: 20,
      skip: 10,
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.get("league")).toBe("england-premier-league");
    expect(calledUrl.searchParams.get("participantId")).toBe("38");
    expect(calledUrl.searchParams.get("status")).toBe("pending,live");
    expect(calledUrl.searchParams.get("from")).toBe("2025-01-01T00:00:00Z");
    expect(calledUrl.searchParams.get("to")).toBe("2025-01-31T23:59:59Z");
    expect(calledUrl.searchParams.get("bookmaker")).toBe("Bet365");
    expect(calledUrl.searchParams.get("limit")).toBe("20");
    expect(calledUrl.searchParams.get("skip")).toBe("10");
  });

  it("get_events omits undefined optional params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_events")!.handler({ sport: "football" });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.has("league")).toBe(false);
    expect(calledUrl.searchParams.has("participantId")).toBe(false);
    expect(calledUrl.searchParams.has("limit")).toBe(false);
  });

  it("get_event uses path parameter", async () => {
    const fetchMock = mockFetchJson({ id: 12345 });
    globalThis.fetch = fetchMock;

    await toolMap.get("get_event")!.handler({ id: 12345 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/events/12345");
  });

  it("get_participant uses path parameter", async () => {
    const fetchMock = mockFetchJson({ id: 38, name: "Chelsea" });
    globalThis.fetch = fetchMock;

    await toolMap.get("get_participant")!.handler({ id: 38 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/participants/38");
  });

  it("get_leagues passes all param when true", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_leagues")!.handler({ sport: "football", all: true });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("all")).toBe("true");
  });

  it("get_leagues omits all param when false", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_leagues")!.handler({ sport: "football", all: false });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.has("all")).toBe(false);
  });

  it("get_value_bets sends includeEventDetails only when true", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_value_bets")!.handler({ bookmaker: "Bet365", includeEventDetails: true });
    const url1 = new URL(fetchMock.mock.calls[0][0]);
    expect(url1.searchParams.get("includeEventDetails")).toBe("true");

    await toolMap.get("get_value_bets")!.handler({ bookmaker: "Bet365", includeEventDetails: false });
    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.has("includeEventDetails")).toBe(false);

    await toolMap.get("get_value_bets")!.handler({ bookmaker: "Bet365" });
    const url3 = new URL(fetchMock.mock.calls[2][0]);
    expect(url3.searchParams.has("includeEventDetails")).toBe(false);
  });

  it("get_arbitrage_bets sends includeEventDetails only when true", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_arbitrage_bets")!.handler({ bookmakers: "Bet365,SingBet", includeEventDetails: true });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.get("includeEventDetails")).toBe("true");

    await toolMap.get("get_arbitrage_bets")!.handler({ bookmakers: "Bet365,SingBet" });
    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.has("includeEventDetails")).toBe(false);
  });

  it("select_bookmakers uses PUT method", async () => {
    const fetchMock = mockFetchJson({ success: true });
    globalThis.fetch = fetchMock;

    await toolMap.get("select_bookmakers")!.handler({ bookmakers: "Bet365,SingBet" });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/bookmakers/selected/select");
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "PUT" });
    expect(calledUrl.searchParams.get("bookmakers")).toBe("Bet365,SingBet");
  });

  it("clear_selected_bookmakers uses PUT method", async () => {
    const fetchMock = mockFetchJson({ success: true });
    globalThis.fetch = fetchMock;

    await toolMap.get("clear_selected_bookmakers")!.handler({});

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/bookmakers/selected/clear");
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: "PUT" });
  });

  it("get_odds_movements passes market and optional marketLine", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;

    await toolMap.get("get_odds_movements")!.handler({
      eventId: "123",
      bookmaker: "Bet365",
      market: "Spread",
      marketLine: "0.5",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/odds/movements");
    expect(calledUrl.searchParams.get("market")).toBe("Spread");
    expect(calledUrl.searchParams.get("marketLine")).toBe("0.5");
  });

  it("get_updated_odds passes since as number", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    const since = 1700000000;
    await toolMap.get("get_updated_odds")!.handler({
      since,
      bookmaker: "Bet365",
      sport: "football",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/odds/updated");
    expect(calledUrl.searchParams.get("since")).toBe(String(since));
  });

  it("get_historical_events passes all required params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_historical_events")!.handler({
      sport: "football",
      league: "england-premier-league",
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T23:59:59Z",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/historical/events");
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.get("league")).toBe("england-premier-league");
    expect(calledUrl.searchParams.get("from")).toBe("2026-01-01T00:00:00Z");
    expect(calledUrl.searchParams.get("to")).toBe("2026-01-31T23:59:59Z");
  });

  it("get_documentation fetches from docs URL and returns text", async () => {
    const docsText = "# Odds API Documentation\nThis is the docs.";
    const fetchMock = mockFetchText(docsText);
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("get_documentation")!.handler({});

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.href).toBe("https://docs.odds-api.io/llms-full.txt");
    expect(result.content[0].text).toBe(docsText);
  });

  it("handler throws on API failure", async () => {
    globalThis.fetch = mockFetchJson({ error: "bad request" }, 400);

    await expect(toolMap.get("get_sports")!.handler({})).rejects.toThrow(
      "API error 400",
    );
  });
});

// ── Edge Cases ───────────────────────────────────────────────────────────────

describe("Edge Cases", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("get_events with skip=0 sends the parameter", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_events")!.handler({ sport: "football", skip: 0 });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("skip")).toBe("0");
  });

  it("search_events passes query through", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("search_events")!.handler({ query: "Liverpool" });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("query")).toBe("Liverpool");
  });

  it("get_multi_odds passes comma-separated IDs", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_multi_odds")!.handler({
      eventIds: "1,2,3",
      bookmakers: "Bet365,Unibet",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.searchParams.get("eventIds")).toBe("1,2,3");
    expect(calledUrl.searchParams.get("bookmakers")).toBe("Bet365,Unibet");
  });

  it("get_documentation throws on fetch failure", async () => {
    globalThis.fetch = mockFetchText("", 500);

    await expect(toolMap.get("get_documentation")!.handler({})).rejects.toThrow(
      "Failed to fetch documentation: 500",
    );
  });
});
