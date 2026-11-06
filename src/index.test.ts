import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Must run before any module evaluation (vi.hoisted is lifted above imports)
vi.hoisted(() => {
  process.env.ODDS_API_KEY = "test-api-key";
});

// Mock the MCP SDK so module-level server setup doesn't fail
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  class MockMcpServer {
    server = { setRequestHandler: vi.fn() };
    connect = vi.fn();
  }
  return { McpServer: MockMcpServer };
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
  ListPromptsRequestSchema: Symbol("ListPromptsRequestSchema"),
  GetPromptRequestSchema: Symbol("GetPromptRequestSchema"),
}));

import {
  tools,
  toolMap,
  prompts,
  apiRequest,
  jsonResponse,
  textResponse,
  errorResponse,
  shapeList,
  filterOutrightOdds,
  getLastRateLimit,
  resetRateLimit,
  SERVER_VERSION,
  API_BASE_URL,
} from "./index.js";

// ── Test Helpers ─────────────────────────────────────────────────────────────

function mockFetchJson(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
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
    "get_markets",
    "get_leagues",
    "get_events",
    "get_event",
    "get_live_events",
    "search_events",
    "get_odds",
    "get_multi_odds",
    "get_odds_summary",
    "get_odds_movements",
    "get_updated_odds",
    "get_dropping_odds",
    "get_historical_events",
    "search_historical_events",
    "get_historical_odds",
    "get_closing_lines",
    "get_settlements",
    "grade_bets",
    "get_value_bets",
    "get_arbitrage_bets",
    "list_outrights",
    "get_outright_odds",
    "get_outright_results",
    "get_participants",
    "get_participant",
    "get_mappings",
    "get_usage",
    "get_documentation",
  ];

  it("has all 33 tools registered", () => {
    expect(tools).toHaveLength(33);
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it("every tool has a title and annotations", () => {
    for (const tool of tools) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(typeof tool.annotations.readOnlyHint).toBe("boolean");
      expect(tool.annotations.openWorldHint).toBe(true);
    }
  });

  it("only the bookmaker selection tools write", () => {
    const writers = tools.filter((t) => !t.annotations.readOnlyHint).map((t) => t.name);
    expect(writers.sort()).toEqual(["clear_selected_bookmakers", "select_bookmakers"]);
    expect(toolMap.get("clear_selected_bookmakers")!.annotations.destructiveHint).toBe(true);
    expect(toolMap.get("clear_selected_bookmakers")!.annotations.idempotentHint).toBe(true);
    expect(toolMap.get("select_bookmakers")!.annotations.destructiveHint).toBe(false);
    expect(toolMap.get("select_bookmakers")!.annotations.idempotentHint).toBe(true);
  });

  it("no tool takes the API key as an argument", () => {
    for (const tool of tools) {
      const props = Object.keys(tool.inputSchema.properties).map((p) => p.toLowerCase());
      expect(props).not.toContain("apikey");
      expect(props).not.toContain("api_key");
    }
  });

  it("descriptions avoid banned wording", () => {
    for (const tool of tools) {
      expect(tool.description).not.toMatch(/risk-free|risk free|free tier|free plan|\u2014/i);
    }
  });

  it("odds tools offer a markets filter", () => {
    for (const name of ["get_odds", "get_multi_odds", "get_historical_odds", "get_odds_summary", "get_arbitrage_bets"]) {
      expect(toolMap.get(name)!.inputSchema.properties).toHaveProperty("markets");
    }
    expect(toolMap.get("get_odds")!.description).toMatch(/Always pass markets/);
  });

  it("uses the canonical base URL and version", () => {
    expect(API_BASE_URL).toBe("https://api.odds-api.io/v3");
    expect(SERVER_VERSION).toBe("1.8.2");
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
    ["get_markets", []],
    ["get_leagues", ["sport"]],
    ["get_events", ["sport"]],
    ["get_event", ["id"]],
    ["get_live_events", []],
    ["search_events", ["query"]],
    ["get_odds", ["eventId", "bookmakers"]],
    ["get_multi_odds", ["eventIds", "bookmakers"]],
    ["get_odds_summary", ["eventId"]],
    ["get_odds_movements", ["eventId", "bookmaker", "market"]],
    ["get_updated_odds", ["since", "bookmaker", "sport", "markets"]],
    ["get_dropping_odds", []],
    ["get_historical_events", ["sport", "league", "from", "to"]],
    ["search_historical_events", ["query"]],
    ["get_historical_odds", ["eventId", "bookmakers"]],
    ["get_closing_lines", ["sport", "leagues", "from", "to", "markets", "bookmakers"]],
    ["get_settlements", ["eventIds"]],
    ["grade_bets", ["selections"]],
    ["get_value_bets", ["bookmaker"]],
    ["get_arbitrage_bets", ["bookmakers"]],
    ["get_participants", ["sport"]],
    ["list_outrights", ["sport"]],
    ["get_outright_odds", ["id", "bookmakers"]],
    ["get_outright_results", ["id"]],
    ["get_participant", ["id"]],
    ["get_mappings", ["bookmaker"]],
    ["get_usage", []],
    ["get_documentation", []],
  ];

  it.each(cases)("%s requires %j", (name, required) => {
    const tool = toolMap.get(name)!;
    expect(tool.inputSchema.required).toEqual(required);
  });
});

// ── Response Helpers ─────────────────────────────────────────────────────────

describe("Response Helpers", () => {
  it("jsonResponse wraps data as compact JSON text", () => {
    const result = jsonResponse({ foo: "bar", nested: { a: 1 } });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(JSON.parse(result.content[0].text)).toEqual({ foo: "bar", nested: { a: 1 } });
    expect(result.content[0].text).not.toContain("\n");
  });

  it("outputs never contain the API key", () => {
    expect(jsonResponse({ url: "x?apiKey=test-api-key" }).content[0].text).not.toContain("test-api-key");
    expect(textResponse("key test-api-key").content[0].text).toBe("key ***");
    expect(errorResponse("bad test-api-key").content[0].text).toBe("Error: bad ***");
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

  it("grade_bets posts the selections as a JSON body", async () => {
    const fetchMock = mockFetchJson({ grades: [] });
    globalThis.fetch = fetchMock;

    const selections = [{ ref: "bet-1", eventId: 123, market: "Spread", hdp: -0.75, side: "home" }];
    await toolMap.get("grade_bets")!.handler({ selections });

    const [calledUrl, init] = fetchMock.mock.calls[0];
    expect(new URL(calledUrl).pathname.endsWith("/settlements/grade")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ selections });
  });

  it("value-bet and arbitrage descriptions state the units", () => {
    expect(toolMap.get("get_value_bets")!.description).toContain("expectedValue is bookmaker/fair x 100; edge % = expectedValue - 100");
    expect(toolMap.get("get_arbitrage_bets")!.description).toContain("profitMargin (already a percentage");
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

  it("get_updated_odds passes since as number and markets", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    const since = 1700000000;
    await toolMap.get("get_updated_odds")!.handler({
      since,
      bookmaker: "Bet365",
      sport: "football",
      markets: "ML,Totals",
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/odds/updated");
    expect(calledUrl.searchParams.get("since")).toBe(String(since));
    expect(calledUrl.searchParams.get("markets")).toBe("ML,Totals");
  });

  it("get_markets passes sport", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_markets")!.handler({ sport: "football" });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/markets");
    expect(calledUrl.searchParams.get("sport")).toBe("football");
  });

  it("get_dropping_odds passes all optional params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_dropping_odds")!.handler({
      sport: "football",
      league: "england-premier-league",
      markets: "ML",
      timeWindow: "12h",
      minDrop: 5,
      limit: 100,
      page: 2,
      includeEventDetails: true,
    });

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/dropping-odds");
    expect(calledUrl.searchParams.get("sport")).toBe("football");
    expect(calledUrl.searchParams.get("league")).toBe("england-premier-league");
    expect(calledUrl.searchParams.get("markets")).toBe("ML");
    expect(calledUrl.searchParams.get("timeWindow")).toBe("12h");
    expect(calledUrl.searchParams.get("minDrop")).toBe("5");
    expect(calledUrl.searchParams.get("limit")).toBe("100");
    expect(calledUrl.searchParams.get("page")).toBe("2");
    expect(calledUrl.searchParams.get("includeEventDetails")).toBe("true");
  });

  it("get_dropping_odds sends includeEventDetails only when true", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_dropping_odds")!.handler({ includeEventDetails: false });
    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.searchParams.has("includeEventDetails")).toBe(false);

    await toolMap.get("get_dropping_odds")!.handler({});
    const url2 = new URL(fetchMock.mock.calls[1][0]);
    expect(url2.searchParams.has("includeEventDetails")).toBe(false);
  });

  it("get_dropping_odds works with no params", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_dropping_odds")!.handler({});

    const calledUrl = new URL(fetchMock.mock.calls[0][0]);
    expect(calledUrl.pathname).toBe("/v3/dropping-odds");
    expect(calledUrl.searchParams.has("sport")).toBe(false);
    expect(calledUrl.searchParams.has("league")).toBe(false);
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

// ── New tools and agent ergonomics ───────────────────────────────────────────

describe("v3 surface tools", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    resetRateLimit();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const urlOf = (fetchMock: ReturnType<typeof vi.fn>, call = 0) => new URL(fetchMock.mock.calls[call][0]);

  it("get_odds and get_multi_odds pass markets", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;

    await toolMap.get("get_odds")!.handler({ eventId: "1", bookmakers: "Bet365", markets: "ML,Totals" });
    await toolMap.get("get_multi_odds")!.handler({ eventIds: "1,2", bookmakers: "Bet365", markets: "Spread" });
    await toolMap.get("get_historical_odds")!.handler({ eventId: "3", bookmakers: "Bet365", markets: "ML" });

    expect(urlOf(fetchMock, 0).pathname).toBe("/v3/odds");
    expect(urlOf(fetchMock, 0).searchParams.get("markets")).toBe("ML,Totals");
    expect(urlOf(fetchMock, 1).pathname).toBe("/v3/odds/multi");
    expect(urlOf(fetchMock, 1).searchParams.get("markets")).toBe("Spread");
    expect(urlOf(fetchMock, 2).pathname).toBe("/v3/historical/odds");
    expect(urlOf(fetchMock, 2).searchParams.get("markets")).toBe("ML");
  });

  it("get_odds omits markets when not given", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;
    await toolMap.get("get_odds")!.handler({ eventId: "1", bookmakers: "Bet365" });
    expect(urlOf(fetchMock).searchParams.has("markets")).toBe(false);
  });

  it("get_odds_summary uses /odds/summary for one id and /odds/summary/multi for several", async () => {
    const fetchMock = mockFetchJson({});
    globalThis.fetch = fetchMock;

    await toolMap.get("get_odds_summary")!.handler({ eventId: "123", markets: "ML", lines: "all", includeExchanges: true });
    await toolMap.get("get_odds_summary")!.handler({ eventId: "1, 2,3", bookmakers: "Bet365,Unibet" });

    const single = urlOf(fetchMock, 0);
    expect(single.pathname).toBe("/v3/odds/summary");
    expect(single.searchParams.get("eventId")).toBe("123");
    expect(single.searchParams.get("markets")).toBe("ML");
    expect(single.searchParams.get("lines")).toBe("all");
    expect(single.searchParams.get("includeExchanges")).toBe("true");

    const multi = urlOf(fetchMock, 1);
    expect(multi.pathname).toBe("/v3/odds/summary/multi");
    expect(multi.searchParams.get("eventIds")).toBe("1,2,3");
    expect(multi.searchParams.get("bookmakers")).toBe("Bet365,Unibet");
    expect(multi.searchParams.has("includeExchanges")).toBe(false);
  });

  it("get_closing_lines passes every parameter", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;

    await toolMap.get("get_closing_lines")!.handler({
      sport: "football",
      leagues: "england-premier-league,spain-laliga",
      from: "2026-01-01T00:00:00Z",
      to: "2026-06-30T23:59:59Z",
      markets: "ML",
      bookmakers: "Bet365",
      limit: 100,
      skip: 200,
    });

    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/v3/historical/closing-lines");
    expect(url.searchParams.get("leagues")).toBe("england-premier-league,spain-laliga");
    expect(url.searchParams.get("markets")).toBe("ML");
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("skip")).toBe("200");
  });

  it("search_historical_events calls the search endpoint", async () => {
    const fetchMock = mockFetchJson([{ id: 1, home: "Arsenal", away: "Chelsea", date: "x", league: {} }]);
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("search_historical_events")!.handler({
      query: "Arsenal",
      sport: "football",
      fields: "id,home",
    });

    expect(urlOf(fetchMock).pathname).toBe("/v3/historical/events/search");
    expect(urlOf(fetchMock).searchParams.get("query")).toBe("Arsenal");
    expect(JSON.parse(result.content[0].text)).toEqual([{ id: 1, home: "Arsenal" }]);
  });

  it("search_events passes status", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;
    await toolMap.get("search_events")!.handler({ query: "Liverpool", status: "live" });
    expect(urlOf(fetchMock).searchParams.get("status")).toBe("live");
  });

  it("get_value_bets passes sport and league", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;
    await toolMap.get("get_value_bets")!.handler({ bookmaker: "Bet365", sport: "baseball", league: "usa-mlb" });
    const url = urlOf(fetchMock);
    expect(url.searchParams.get("sport")).toBe("baseball");
    expect(url.searchParams.get("league")).toBe("usa-mlb");
  });

  it("get_arbitrage_bets passes the newer filters", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;
    await toolMap.get("get_arbitrage_bets")!.handler({
      bookmakers: "Bet365,SingBet",
      sport: "football",
      league: "england-premier-league",
      markets: "Totals",
      minProfit: 1.5,
      allCombinations: true,
      limit: 20,
    });
    const url = urlOf(fetchMock);
    expect(url.searchParams.get("sport")).toBe("football");
    expect(url.searchParams.get("league")).toBe("england-premier-league");
    expect(url.searchParams.get("markets")).toBe("Totals");
    expect(url.searchParams.get("minProfit")).toBe("1.5");
    expect(url.searchParams.get("allCombinations")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("20");
  });

  it("get_updated_odds passes limit", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;
    await toolMap.get("get_updated_odds")!.handler({
      since: 1,
      bookmaker: "Bet365",
      sport: "football",
      markets: "ML",
      limit: 500,
    });
    expect(urlOf(fetchMock).searchParams.get("limit")).toBe("500");
    expect(toolMap.get("get_updated_odds")!.inputSchema.properties.markets).toMatchObject({
      description: expect.stringContaining("max 40"),
    });
  });

  it("get_markets works without a sport", async () => {
    const fetchMock = mockFetchJson([]);
    globalThis.fetch = fetchMock;
    await toolMap.get("get_markets")!.handler({});
    expect(urlOf(fetchMock).pathname).toBe("/v3/markets");
    expect(urlOf(fetchMock).searchParams.has("sport")).toBe(false);
  });

  it("get_mappings passes lookup and bulk parameters, including active=false", async () => {
    const fetchMock = mockFetchJson({ data: [{ eventId: 1, marketId: "m", extra: {} }], nextCursor: "abc" });
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("get_mappings")!.handler({
      bookmaker: "Kalshi",
      sport: "american-football",
      limit: 5000,
      cursor: "prev",
      active: false,
      fields: "eventId,marketId",
    });

    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/v3/mappings");
    expect(url.searchParams.get("bookmaker")).toBe("Kalshi");
    expect(url.searchParams.get("cursor")).toBe("prev");
    expect(url.searchParams.get("active")).toBe("false");
    expect(JSON.parse(result.content[0].text)).toEqual({ data: [{ eventId: 1, marketId: "m" }], nextCursor: "abc" });
  });

  it("list_outrights passes sport, league and status", async () => {
    const fetchMock = mockFetchJson([{ id: 1001, name: "The Open", bookmakerCount: 12 }]);
    globalThis.fetch = fetchMock;
    await toolMap.get("list_outrights")!.handler({ sport: "golf", league: "majors", status: "pending,live" });
    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/v3/outrights");
    expect(url.searchParams.get("sport")).toBe("golf");
    expect(url.searchParams.get("league")).toBe("majors");
    expect(url.searchParams.get("status")).toBe("pending,live");
  });

  it("get_outright_odds filters markets and runners after the call", async () => {
    const payload = {
      id: 1001,
      name: "The Open",
      bookmakers: {
        DraftKings: [
          { name: "Winner", odds: [{ label: "A", odds: "5.0" }, { label: "B", odds: "7.0" }, { label: "C", odds: "9.0" }] },
          { name: "Top 10 (Incl. Ties)", odds: [{ label: "A", odds: "1.5" }] },
          { name: "Make Cut", odds: [{ label: "A", yes: "1.1", no: "6.0" }] },
        ],
        Kalshi: [{ name: "Make Cut", odds: [{ label: "A", yes: "1.1", no: "6.0" }] }],
      },
    };
    const fetchMock = mockFetchJson(payload);
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("get_outright_odds")!.handler({
      id: 1001,
      bookmakers: "DraftKings,Kalshi",
      markets: "winner, Top 10 (Incl. Ties)",
      maxRunners: 2,
    });

    const url = urlOf(fetchMock);
    expect(url.pathname).toBe("/v3/outrights/odds");
    expect(url.searchParams.get("id")).toBe("1001");
    expect(url.searchParams.has("markets")).toBe(false);

    const body = JSON.parse(result.content[0].text);
    expect(Object.keys(body.bookmakers)).toEqual(["DraftKings"]);
    expect(body.bookmakers.DraftKings.map((m: { name: string }) => m.name)).toEqual(["Winner", "Top 10 (Incl. Ties)"]);
    expect(body.bookmakers.DraftKings[0].odds).toHaveLength(2);
  });

  it("get_outright_odds returns the payload untouched without filters", () => {
    const payload = { id: 1, bookmakers: { X: [{ name: "Winner", odds: [] }] } };
    expect(filterOutrightOdds(payload, {})).toBe(payload);
  });

  it("get_outright_results calls the results endpoint", async () => {
    const fetchMock = mockFetchJson({ id: 1001, results: [], winners: {} });
    globalThis.fetch = fetchMock;
    await toolMap.get("get_outright_results")!.handler({ id: 1001 });
    expect(urlOf(fetchMock).pathname).toBe("/v3/outrights/results");
    expect(urlOf(fetchMock).searchParams.get("id")).toBe("1001");
  });

  it("passes the outrights add-on 403 message through with guidance", async () => {
    const body = { error: "Outrights are a paid add-on. Add it in your dashboard: https://odds-api.io/dashboard/billing#outrights" };
    globalThis.fetch = mockFetchJson(body, 403);

    const promise = toolMap.get("list_outrights")!.handler({ sport: "golf" });
    await expect(promise).rejects.toThrow("API error 403");
    await expect(toolMap.get("list_outrights")!.handler({ sport: "golf" })).rejects.toThrow(
      /Outrights are a paid add-on.*dashboard\/billing#outrights.*Retrying will not help/,
    );
  });

  it("429 errors carry the reset time and say not to retry", async () => {
    globalThis.fetch = mockFetchJson({ error: "You have exceeded your rate limit" }, 429, {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": "2026-11-06T15:00:00Z",
    });
    await expect(toolMap.get("get_sports")!.handler({})).rejects.toThrow(
      /API error 429.*until 2026-11-06T15:00:00Z.*Do not retry/,
    );
  });

  it("error messages never contain the API key", async () => {
    globalThis.fetch = mockFetchJson({ error: "bad key test-api-key" }, 401);
    await expect(toolMap.get("get_sports")!.handler({})).rejects.toThrow(/bad key \*\*\*/);
    await expect(toolMap.get("get_sports")!.handler({})).rejects.not.toThrow(/test-api-key/);

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("connect failed for ?apiKey=test-api-key"));
    await expect(apiRequest("/sports")).rejects.toThrow(/apiKey=\*\*\*/);
  });

  it("get_usage reports the rate-limit headers of the latest call", async () => {
    const fetchMock = mockFetchJson([], 200, {
      "x-ratelimit-limit": "5000",
      "x-ratelimit-remaining": "4990",
      "x-ratelimit-reset": "2026-11-06T15:00:00Z",
    });
    globalThis.fetch = fetchMock;

    await toolMap.get("get_events")!.handler({ sport: "football" });
    const result = await toolMap.get("get_usage")!.handler({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const usage = JSON.parse(result.content[0].text);
    expect(usage).toMatchObject({ limit: 5000, remaining: 4990, reset: "2026-11-06T15:00:00Z" });
    expect(getLastRateLimit()?.remaining).toBe(4990);
  });

  it("get_usage makes one cheap call when nothing was seen yet", async () => {
    const fetchMock = mockFetchJson([], 200, { "x-ratelimit-limit": "5000", "x-ratelimit-remaining": "4999" });
    globalThis.fetch = fetchMock;

    const result = await toolMap.get("get_usage")!.handler({});

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(urlOf(fetchMock).pathname).toBe("/v3/sports");
    expect(JSON.parse(result.content[0].text)).toMatchObject({ remaining: 4999, source: expect.stringContaining("get_sports") });
  });

  it("grade_bets accepts label-only selections", () => {
    const items = (toolMap.get("grade_bets")!.inputSchema.properties.selections as { items: { required: string[] } }).items;
    expect(items.required).toEqual(["eventId", "market"]);
  });
});

describe("Response shaping", () => {
  it("keeps only requested fields on each item", () => {
    expect(shapeList([{ a: 1, b: 2 }, { a: 3, c: 4 }], { fields: "a" })).toEqual([{ a: 1 }, { a: 3 }]);
  });

  it("caps lists with maxResults and says so", () => {
    expect(shapeList([1, 2, 3], { maxResults: 2 })).toEqual({ total: 3, returned: 2, truncated: true, results: [1, 2] });
    expect(shapeList([1, 2], { maxResults: 5 })).toEqual([1, 2]);
  });

  it("shapes list values inside objects (markets catalogue, all-sport map)", () => {
    const one = { sport: { name: "Football", slug: "football" }, markets: [{ name: "ML", shape: "moneyline", live: true }] };
    expect(shapeList(one, { fields: "name" })).toEqual({ sport: one.sport, markets: [{ name: "ML" }] });
    const all = { football: [{ name: "ML", period: "match" }], tennis: [{ name: "ML", period: "match" }] };
    expect(shapeList(all, { fields: "name" })).toEqual({ football: [{ name: "ML" }], tennis: [{ name: "ML" }] });
  });

  it("leaves data untouched without options", () => {
    const data = [{ a: 1 }];
    expect(shapeList(data, {})).toEqual(data);
  });
});

describe("Prompts", () => {
  it("defines compare_odds, settle_bets and golf_outrights", () => {
    expect(prompts.map((p) => p.name)).toEqual(["compare_odds", "settle_bets", "golf_outrights"]);
  });

  it("golf_outrights points at the outrights tools", () => {
    const text = prompts.find((p) => p.name === "golf_outrights")!.render({ market: "Top 10" });
    expect(text).toContain("list_outrights");
    expect(text).toContain("get_outright_odds");
    expect(text).toContain("markets=Top 10");
  });
});
