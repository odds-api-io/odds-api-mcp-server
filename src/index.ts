#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const API_BASE_URL = "https://api2.odds-api.io/v3";
const DOCS_BASE_URL = "https://docs.odds-api.io";
const API_KEY = process.env.ODDS_API_KEY ?? "";

// ── Types ────────────────────────────────────────────────────────────────────

type ParamValue = string | number | boolean | undefined;

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler(args: Record<string, unknown>): Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

// ── API Client ───────────────────────────────────────────────────────────────

async function apiRequest(
  endpoint: string,
  params: Record<string, ParamValue> = {},
  method: "GET" | "PUT" = "GET",
): Promise<unknown> {
  if (!API_KEY) {
    throw new Error("ODDS_API_KEY environment variable is not set");
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set("apiKey", API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url.toString(), { method });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`API error ${response.status}: ${body}`);
  }

  return response.json();
}

// ── Response Helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function textResponse(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// ── Tool Definitions ─────────────────────────────────────────────────────────

const tools: ToolDefinition[] = [
  // ── Sports ──────────────────────────────────────────────────────

  {
    name: "get_sports",
    description: "List all available sports with their name and slug identifier.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(await apiRequest("/sports"));
    },
  },

  // ── Bookmakers ──────────────────────────────────────────────────

  {
    name: "get_bookmakers",
    description: "List all supported bookmakers with their name and active status.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(await apiRequest("/bookmakers"));
    },
  },
  {
    name: "get_selected_bookmakers",
    description: "Get the authenticated user's currently selected bookmakers.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(await apiRequest("/bookmakers/selected"));
    },
  },
  {
    name: "select_bookmakers",
    description: "Add bookmakers to the authenticated user's selection.",
    inputSchema: {
      type: "object",
      properties: {
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (e.g., 'Bet365,SingBet')",
        },
      },
      required: ["bookmakers"],
    },
    async handler(args) {
      const { bookmakers } = args as { bookmakers: string };
      return jsonResponse(
        await apiRequest("/bookmakers/selected/select", { bookmakers }, "PUT"),
      );
    },
  },
  {
    name: "clear_selected_bookmakers",
    description:
      "Clear all selected bookmakers for the authenticated user. Limited to once every 12 hours.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(
        await apiRequest("/bookmakers/selected/clear", {}, "PUT"),
      );
    },
  },

  // ── Leagues ─────────────────────────────────────────────────────

  {
    name: "get_leagues",
    description: "Get leagues for a sport. Returns league name, slug, and active event count.",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug (e.g., 'football', 'basketball', 'tennis')",
        },
        all: {
          type: "boolean",
          description: "If true, include leagues without active events",
        },
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, all } = args as { sport: string; all?: boolean };
      return jsonResponse(
        await apiRequest("/leagues", { sport, all: all || undefined }),
      );
    },
  },

  // ── Events ──────────────────────────────────────────────────────

  {
    name: "get_events",
    description:
      "Get events for a sport with filtering by league, participant, status, date range, bookmaker availability, and pagination support.",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug (e.g., 'football', 'basketball')",
        },
        league: {
          type: "string",
          description: "League slug (e.g., 'england-premier-league')",
        },
        participantId: {
          type: "number",
          description: "Filter by participant/team ID (matches home or away)",
        },
        status: {
          type: "string",
          description: "Comma-separated event statuses: pending, live, settled",
        },
        from: {
          type: "string",
          description: "Start date/time in RFC3339 format (e.g., '2025-10-28T10:00:00Z')",
        },
        to: {
          type: "string",
          description: "End date/time in RFC3339 format (e.g., '2025-10-28T23:59:59Z')",
        },
        bookmaker: {
          type: "string",
          description: "Only return events with odds from this bookmaker (e.g., 'Bet365')",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return",
        },
        skip: {
          type: "number",
          description: "Number of events to skip for pagination",
        },
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, league, participantId, status, from, to, bookmaker, limit, skip } = args as {
        sport: string;
        league?: string;
        participantId?: number;
        status?: string;
        from?: string;
        to?: string;
        bookmaker?: string;
        limit?: number;
        skip?: number;
      };
      return jsonResponse(
        await apiRequest("/events", {
          sport,
          league,
          participantId,
          status,
          from,
          to,
          bookmaker,
          limit,
          skip,
        }),
      );
    },
  },
  {
    name: "get_event",
    description: "Get a single event by its unique ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Event ID" },
      },
      required: ["id"],
    },
    async handler(args) {
      const { id } = args as { id: number };
      return jsonResponse(await apiRequest(`/events/${id}`));
    },
  },
  {
    name: "get_live_events",
    description: "Get all currently live events across all sports, optionally filtered by sport.",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug to filter live events (e.g., 'football')",
        },
      },
      required: [],
    },
    async handler(args) {
      const { sport } = args as { sport?: string };
      return jsonResponse(await apiRequest("/events/live", { sport }));
    },
  },
  {
    name: "search_events",
    description: "Search events by team name or text query. Returns up to 10 matching results.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term (minimum 3 characters)",
        },
      },
      required: ["query"],
    },
    async handler(args) {
      const { query } = args as { query: string };
      return jsonResponse(await apiRequest("/events/search", { query }));
    },
  },

  // ── Odds ────────────────────────────────────────────────────────

  {
    name: "get_odds",
    description: "Get betting odds for a specific event from selected bookmakers.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names, max 30 (e.g., 'Bet365,Pinnacle,Unibet')",
        },
      },
      required: ["eventId", "bookmakers"],
    },
    async handler(args) {
      const { eventId, bookmakers } = args as { eventId: string; bookmakers: string };
      return jsonResponse(await apiRequest("/odds", { eventId, bookmakers }));
    },
  },
  {
    name: "get_multi_odds",
    description:
      "Get odds for multiple events in a single request (up to 10 events). Counts as only 1 API call.",
    inputSchema: {
      type: "object",
      properties: {
        eventIds: {
          type: "string",
          description: "Comma-separated event IDs (max 10)",
        },
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (max 30)",
        },
      },
      required: ["eventIds", "bookmakers"],
    },
    async handler(args) {
      const { eventIds, bookmakers } = args as { eventIds: string; bookmakers: string };
      return jsonResponse(await apiRequest("/odds/multi", { eventIds, bookmakers }));
    },
  },
  {
    name: "get_odds_movements",
    description:
      "Get historical odds line movements for an event from a bookmaker. Returns opening, latest, and all intermediate price changes for a specific market.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g., 'Bet365')",
        },
        market: {
          type: "string",
          description: "Market type (e.g., 'ML', 'Spread', 'Totals')",
        },
        marketLine: {
          type: "string",
          description: "Handicap/total line (e.g., '0.5', '2.5'). Not required for ML markets.",
        },
      },
      required: ["eventId", "bookmaker", "market"],
    },
    async handler(args) {
      const { eventId, bookmaker, market, marketLine } = args as {
        eventId: string;
        bookmaker: string;
        market: string;
        marketLine?: string;
      };
      return jsonResponse(
        await apiRequest("/odds/movements", { eventId, bookmaker, market, marketLine }),
      );
    },
  },
  {
    name: "get_updated_odds",
    description:
      "Get odds updated since a Unix timestamp for a bookmaker and sport. The timestamp must be at most 1 minute old. Useful for efficient polling.",
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "number",
          description: "Unix timestamp (must be within the last 60 seconds)",
        },
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g., 'Bet365')",
        },
        sport: {
          type: "string",
          description: "Sport slug (e.g., 'football')",
        },
      },
      required: ["since", "bookmaker", "sport"],
    },
    async handler(args) {
      const { since, bookmaker, sport } = args as {
        since: number;
        bookmaker: string;
        sport: string;
      };
      return jsonResponse(
        await apiRequest("/odds/updated", { since, bookmaker, sport }),
      );
    },
  },

  // ── Dropping Odds ───────────────────────────────────────────────

  {
    name: "get_dropping_odds",
    description:
      "Get odds that have dropped the most from opening, based on sharp bookmaker data. Useful for tracking where sharp money is moving. Updated every ~10 seconds. Only available on paid plans. Response includes drop percentages for multiple time windows (sinceOpening, 12h, 24h, 48h). For player prop markets, the response includes market.label with the player name (e.g. 'Carlos Baleba'). Use market=Player Props to get all player prop markets across all sports (football includes Anytime Goalscorer, Player Passes, Player Shots, Player Shots on Target, etc.).",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug to filter by (e.g., 'football', 'basketball')",
        },
        league: {
          type: "string",
          description: "Single league slug to filter by (e.g., 'england-premier-league'). Requires sport. Mutually exclusive with leagues.",
        },
        leagues: {
          type: "string",
          description: "Comma-separated league slugs to filter by multiple leagues (e.g., 'england-premier-league,spain-la-liga'). Mutually exclusive with league.",
        },
        market: {
          type: "string",
          description:
            "Market name to filter by (case-insensitive). Supported: ML, Spread, Totals, Spread HT, Totals HT, Totals 1Q, Spread 1Q, Team Total Home, Team Total Away, Corners Spread, Corners Totals, Corners Spread HT, Corners Totals HT, Bookings Spread, Bookings Totals, Player Props. Note: 'Player Props' returns all player prop markets across all sports.",
        },
        timeWindow: {
          type: "string",
          description: "Time window for drop filtering and sorting: 'opening', '12h', '24h', '48h' (default: 'opening')",
        },
        sort: {
          type: "string",
          description: "Sort order: 'drop' (highest drop %), 'recent' (latest movement), 'kickoff' (soonest event). Default: 'drop'",
        },
        minDrop: {
          type: "number",
          description: "Minimum drop percentage threshold (default: 0)",
        },
        limit: {
          type: "number",
          description: "Results per page, 1-200 (default: 50)",
        },
        page: {
          type: "number",
          description: "Page number, 1-indexed (default: 1)",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include expanded event details (home, away, date, sport, league) in response",
        },
      },
      required: [],
    },
    async handler(args) {
      const { sport, league, leagues, market, timeWindow, sort, minDrop, limit, page, includeEventDetails } =
        args as {
          sport?: string;
          league?: string;
          leagues?: string;
          market?: string;
          timeWindow?: string;
          sort?: string;
          minDrop?: number;
          limit?: number;
          page?: number;
          includeEventDetails?: boolean;
        };
      return jsonResponse(
        await apiRequest("/dropping-odds", {
          sport,
          league,
          leagues,
          market,
          timeWindow,
          sort,
          minDrop,
          limit,
          page,
          includeEventDetails: includeEventDetails || undefined,
        }),
      );
    },
  },

  // ── Historical ──────────────────────────────────────────────────

  {
    name: "get_historical_events",
    description:
      "Get finished events for a sport and league within a date range (max 31-day span).",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug (e.g., 'football')",
        },
        league: {
          type: "string",
          description: "League slug (e.g., 'england-premier-league')",
        },
        from: {
          type: "string",
          description: "Start date in RFC3339 format (e.g., '2026-01-01T00:00:00Z')",
        },
        to: {
          type: "string",
          description: "End date in RFC3339 format (e.g., '2026-01-31T23:59:59Z')",
        },
      },
      required: ["sport", "league", "from", "to"],
    },
    async handler(args) {
      const { sport, league, from, to } = args as {
        sport: string;
        league: string;
        from: string;
        to: string;
      };
      return jsonResponse(
        await apiRequest("/historical/events", { sport, league, from, to }),
      );
    },
  },
  {
    name: "get_historical_odds",
    description:
      "Get closing odds and final scores for a finished event from selected bookmakers.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "Event ID (from get_historical_events)",
        },
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (max 30)",
        },
      },
      required: ["eventId", "bookmakers"],
    },
    async handler(args) {
      const { eventId, bookmakers } = args as { eventId: string; bookmakers: string };
      return jsonResponse(
        await apiRequest("/historical/odds", { eventId, bookmakers }),
      );
    },
  },

  // ── Value Bets ──────────────────────────────────────────────────

  {
    name: "get_value_bets",
    description:
      "Get positive expected value betting opportunities for a bookmaker. Updated every 5 seconds. EV formula: (Probability x Odds) - 1.",
    inputSchema: {
      type: "object",
      properties: {
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g., 'Bet365')",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include full event details (sport, league, teams, date) in response",
        },
      },
      required: ["bookmaker"],
    },
    async handler(args) {
      const { bookmaker, includeEventDetails } = args as {
        bookmaker: string;
        includeEventDetails?: boolean;
      };
      return jsonResponse(
        await apiRequest("/value-bets", {
          bookmaker,
          includeEventDetails: includeEventDetails || undefined,
        }),
      );
    },
  },

  // ── Arbitrage Bets ──────────────────────────────────────────────

  {
    name: "get_arbitrage_bets",
    description:
      "Get arbitrage opportunities across bookmakers. Returns profit margin, optimal stake distribution, and direct bet links for each leg.",
    inputSchema: {
      type: "object",
      properties: {
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (e.g., 'Bet365,SingBet')",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 50, max 500)",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include full event details in response",
        },
      },
      required: ["bookmakers"],
    },
    async handler(args) {
      const { bookmakers, limit, includeEventDetails } = args as {
        bookmakers: string;
        limit?: number;
        includeEventDetails?: boolean;
      };
      return jsonResponse(
        await apiRequest("/arbitrage-bets", {
          bookmakers,
          limit,
          includeEventDetails: includeEventDetails || undefined,
        }),
      );
    },
  },

  // ── Participants ────────────────────────────────────────────────

  {
    name: "get_participants",
    description: "Get teams/participants for a sport, optionally filtered by name search.",
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug (e.g., 'football')",
        },
        search: {
          type: "string",
          description: "Search term to filter by team/participant name",
        },
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, search } = args as { sport: string; search?: string };
      return jsonResponse(await apiRequest("/participants", { sport, search }));
    },
  },
  {
    name: "get_participant",
    description: "Get a single participant/team by their unique ID.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Participant ID" },
      },
      required: ["id"],
    },
    async handler(args) {
      const { id } = args as { id: number };
      return jsonResponse(await apiRequest(`/participants/${id}`));
    },
  },

  // ── Documentation ───────────────────────────────────────────────

  {
    name: "get_documentation",
    description: "Fetch the complete Odds-API.io API documentation.",
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      const response = await fetch(`${DOCS_BASE_URL}/llms-full.txt`);
      if (!response.ok) {
        throw new Error(`Failed to fetch documentation: ${response.status}`);
      }
      return textResponse(await response.text());
    },
  },
];

// ── Server Setup ─────────────────────────────────────────────────────────────

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

const server = new Server(
  { name: "odds-api-mcp", version: "1.4.0" },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = toolMap.get(name);

  if (!tool) {
    return errorResponse(`Unknown tool: ${name}`);
  }

  try {
    return await tool.handler(args ?? {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return errorResponse(message);
  }
});

// ── Resources ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "odds-api://documentation",
      name: "Odds-API.io Documentation",
      description: "Complete API documentation for Odds-API.io",
      mimeType: "text/plain",
    },
    {
      uri: "odds-api://openapi",
      name: "OpenAPI Specification",
      description: "OpenAPI/Swagger specification for Odds-API.io",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "odds-api://documentation": {
      const response = await fetch(`${DOCS_BASE_URL}/llms-full.txt`);
      if (!response.ok) throw new Error(`Failed to fetch docs: ${response.status}`);
      return {
        contents: [{ uri, mimeType: "text/plain", text: await response.text() }],
      };
    }
    case "odds-api://openapi": {
      const response = await fetch(`${DOCS_BASE_URL}/api-reference/openapi.json`);
      if (!response.ok) throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`);
      return {
        contents: [
          {
            uri,
            mimeType: "application/json",
            text: JSON.stringify(await response.json(), null, 2),
          },
        ],
      };
    }
    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error("Error: ODDS_API_KEY environment variable is required");
    process.exit(1);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Odds-API.io MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

// ── Exports (for testing) ────────────────────────────────────────────────────

export { tools, toolMap, apiRequest, jsonResponse, textResponse, errorResponse };
