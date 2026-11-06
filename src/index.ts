#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// ── Constants ────────────────────────────────────────────────────────────────

const SERVER_NAME = "odds-api-mcp";
const SERVER_VERSION = "1.8.1";
const API_BASE_URL = "https://api.odds-api.io/v3";
const DOCS_BASE_URL = "https://docs.odds-api.io";
const PRICING_URL = "https://odds-api.io/pricing?ref=mcp";
const API_KEY = process.env.ODDS_API_KEY ?? "";

const SERVER_INSTRUCTIONS = `Odds-API.io: live and pre-match odds from 450+ bookmakers across 34 sports.

Call order:
1. Call get_sports, then get_leagues for sport and league slugs. Never guess slugs.
2. Find events with get_events (sport + league), search_events (team name) or get_live_events.
3. Call get_markets for the exact market names (ML, Spread, Totals, ...; never "Match Winner").
4. get_odds / get_multi_odds with bookmakers AND markets. Always pass markets: without it every market from every bookmaker comes back and responses get very large.
5. Bookmakers must be in the key's selection: check get_selected_bookmakers.

Keep responses small: use markets, fields and maxResults/limit arguments. get_odds_summary gives best/average/fair prices per line in one compact response.
Errors: a 403 means the plan or add-on does not include the endpoint; tell the user the message (it names what to enable) and do not retry. A 429 means the hourly limit is spent until the reset time it gives; do not retry before then. get_usage shows the remaining requests.
Scores: periods use keys p1..pN, ft, ot, ap. The older keys period1, overtime, penalties and fulltime stop on 12 November 2026.
When quoting a price, name the bookmaker and when it was updated. Prices are not predictions.`;

// ── Types ────────────────────────────────────────────────────────────────────

type ParamValue = string | number | boolean | undefined;

interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  annotations: ToolAnnotations;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
  handler(args: Record<string, unknown>): Promise<ToolResult>;
}

interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  reset: string | null;
  observedAt: string;
}

// ── Key safety ───────────────────────────────────────────────────────────────

function redact(text: string): string {
  if (!API_KEY) return text;
  return text.split(API_KEY).join("***");
}

// ── API Client ───────────────────────────────────────────────────────────────

let lastRateLimit: RateLimitInfo | null = null;

function getLastRateLimit(): RateLimitInfo | null {
  return lastRateLimit;
}

function resetRateLimit(): void {
  lastRateLimit = null;
}

function recordRateLimit(headers: Headers | undefined): void {
  const get = (name: string) => headers?.get?.(name) ?? null;
  const limit = get("x-ratelimit-limit");
  const remaining = get("x-ratelimit-remaining");
  const reset = get("x-ratelimit-reset");
  if (limit === null && remaining === null && reset === null) return;
  lastRateLimit = {
    limit: limit === null ? null : Number(limit),
    remaining: remaining === null ? null : Number(remaining),
    reset,
    observedAt: new Date().toISOString(),
  };
}

function describeApiError(status: number, body: string, reset: string | null): string {
  const base = `API error ${status}: ${body}`;
  switch (status) {
    case 400:
      return `${base}. Fix the arguments and try again. For market names call get_markets; for slugs call get_sports and get_leagues.`;
    case 401:
      return `${base}. The ODDS_API_KEY was rejected. Ask the user to check the key in their MCP config; plans are at ${PRICING_URL}.`;
    case 403:
      return `${base}. This key's plan or add-ons do not include this endpoint. Tell the user what the message says (it names the plan or add-on and where to enable it). Retrying will not help.`;
    case 404:
      return `${base}. Nothing was found for these arguments.`;
    case 429:
      return `${base}. The hourly request limit is spent${reset ? ` until ${reset}` : ""}. Do not retry before then.`;
    default:
      if (status >= 500) {
        return `${base}. Temporary server error. Retry once after a few seconds.`;
      }
      return base;
  }
}

async function apiRequest(
  endpoint: string,
  params: Record<string, ParamValue> = {},
  method: "GET" | "PUT" | "POST" = "GET",
  jsonBody?: unknown,
): Promise<unknown> {
  if (!API_KEY) {
    throw new Error("ODDS_API_KEY environment variable is not set");
  }

  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set("apiKey", API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  let response: Response;
  try {
    response = await fetch(
      url.toString(),
      jsonBody === undefined
        ? { method }
        : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(jsonBody) },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(redact(`Network error calling ${endpoint}: ${message}`));
  }

  recordRateLimit(response.headers);

  if (!response.ok) {
    const body = redact(await response.text());
    throw new Error(describeApiError(response.status, body, lastRateLimit?.reset ?? null));
  }

  return response.json();
}

// ── Response Helpers ─────────────────────────────────────────────────────────

function jsonResponse(data: unknown): ToolResult {
  return { content: [{ type: "text" as const, text: redact(JSON.stringify(data)) }] };
}

function textResponse(text: string): ToolResult {
  return { content: [{ type: "text" as const, text: redact(text) }] };
}

function errorResponse(message: string): ToolResult {
  return { content: [{ type: "text" as const, text: `Error: ${redact(message)}` }], isError: true };
}

function splitList(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickFields(item: unknown, fields: string[]): unknown {
  if (!item || typeof item !== "object" || Array.isArray(item)) return item;
  const source = item as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) picked[field] = source[field];
  }
  return picked;
}

function shapeList(data: unknown, args: Record<string, unknown>): unknown {
  const fields = splitList(args.fields);
  const maxResults = typeof args.maxResults === "number" && args.maxResults > 0 ? args.maxResults : undefined;

  const shapeArray = (items: unknown[]) => {
    const kept = maxResults !== undefined ? items.slice(0, maxResults) : items;
    return fields.length ? kept.map((item) => pickFields(item, fields)) : kept;
  };

  if (Array.isArray(data)) {
    const shaped = shapeArray(data);
    if (maxResults !== undefined && data.length > maxResults) {
      return { total: data.length, returned: shaped.length, truncated: true, results: shaped };
    }
    return shaped;
  }
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const listKeys = Object.keys(record).filter((key) => Array.isArray(record[key]));
    if (listKeys.length) {
      const shaped: Record<string, unknown> = { ...record };
      for (const key of listKeys) shaped[key] = shapeArray(record[key] as unknown[]);
      return shaped;
    }
    return fields.length ? pickFields(record, fields) : record;
  }
  return data;
}

function listResponse(data: unknown, args: Record<string, unknown>): ToolResult {
  return jsonResponse(shapeList(data, args));
}

function filterOutrightOdds(data: unknown, args: Record<string, unknown>): unknown {
  const markets = splitList(args.markets).map((m) => m.toLowerCase());
  const maxRunners = typeof args.maxRunners === "number" && args.maxRunners > 0 ? args.maxRunners : undefined;
  if (!markets.length && maxRunners === undefined) return data;
  if (!data || typeof data !== "object") return data;

  const record = data as Record<string, unknown>;
  const books = record.bookmakers;
  if (!books || typeof books !== "object") return data;

  const filtered: Record<string, unknown> = {};
  for (const [book, list] of Object.entries(books as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    const kept = list
      .filter((m) => !markets.length || markets.includes(String((m as { name?: unknown }).name ?? "").toLowerCase()))
      .map((m) => {
        const market = m as { odds?: unknown };
        if (maxRunners === undefined || !Array.isArray(market.odds)) return m;
        return { ...market, odds: market.odds.slice(0, maxRunners) };
      });
    if (kept.length) filtered[book] = kept;
  }
  return { ...record, bookmakers: filtered };
}

// ── Shared schema fragments ──────────────────────────────────────────────────

const READ_ONLY: Omit<ToolAnnotations, "title"> = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

const fieldsProp = {
  type: "string",
  description:
    "Optional comma-separated top-level fields to keep on each item (e.g. 'id,home,away,date,status'). Trims large responses.",
};

const maxResultsProp = {
  type: "number",
  description: "Optional cap on the number of items returned to you (applied after the API call).",
};

const marketsOddsProp = {
  type: "string",
  description:
    "Comma-separated market names, case-insensitive, max 40 (e.g. 'ML,Spread,Totals'). Strongly recommended: without it every market is returned. Call get_markets for the exact names.",
};

const sportProp = {
  type: "string",
  description: "Sport slug from get_sports (e.g. 'football', 'basketball', 'tennis')",
};

const leagueProp = {
  type: "string",
  description: "League slug from get_leagues (e.g. 'england-premier-league')",
};

const bookmakersProp = {
  type: "string",
  description:
    "Comma-separated bookmaker names, max 30 (e.g. 'Bet365,SingBet'). Must be in the key's selection (get_selected_bookmakers).",
};

const SCORE_KEYS_NOTE =
  "Score periods use keys p1..pN, ft, ot and ap (older keys period1, overtime, penalties, fulltime stop on 12 November 2026).";

// ── Tool Definitions ─────────────────────────────────────────────────────────

const tools: ToolDefinition[] = [
  // ── Catalogue ───────────────────────────────────────────────────

  {
    name: "get_sports",
    title: "List sports",
    description:
      "List every sport with its name and slug. Call this first: other tools take the slug (e.g. 'football', 'american-football'). No plan needed.",
    annotations: READ_ONLY,
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(await apiRequest("/sports"));
    },
  },
  {
    name: "get_markets",
    title: "List market names",
    description:
      "List the exact market names served per sport, with shape (moneyline, line, outcomes, yesno, labelled), period, and whether each is served prematch and live. Call it before passing markets to any odds tool; names must match in full, e.g. 'ML' not 'Match Winner', 'Totals' not 'Over/Under'. Omitting sport returns every sport (large).",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        fields: {
          type: "string",
          description: "Optional comma-separated fields to keep per market (e.g. 'name,live')",
        },
      },
      required: [],
    },
    async handler(args) {
      const { sport } = args as { sport?: string };
      return listResponse(await apiRequest("/markets", { sport }), args);
    },
  },
  {
    name: "get_bookmakers",
    title: "List bookmakers",
    description:
      "List all bookmakers with name, active, createdAt, status (ok, degraded, down) and reason (maintenance, unavailable, or null). Use status/reason to explain why a bookmaker has no odds: a 'down' bookmaker is left out of odds, value bets and arbitrage until it recovers.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: { fields: fieldsProp, maxResults: maxResultsProp },
      required: [],
    },
    async handler(args) {
      return listResponse(await apiRequest("/bookmakers"), args);
    },
  },
  {
    name: "get_selected_bookmakers",
    title: "Show selected bookmakers",
    description:
      "Show the bookmakers selected on this API key. Odds tools only return bookmakers in this selection; the plan sets how many can be selected.",
    annotations: READ_ONLY,
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(await apiRequest("/bookmakers/selected"));
    },
  },
  {
    name: "select_bookmakers",
    title: "Add bookmakers to selection",
    description:
      "Add bookmakers to this API key's selection (changes account state). Only call when the user asks to change their bookmakers; the plan caps how many can be selected.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names from get_bookmakers (e.g. 'Bet365,SingBet')",
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
    title: "Clear bookmaker selection",
    description:
      "Remove every bookmaker from this API key's selection (destructive). Allowed once every 12 hours, so only call it when the user explicitly asks.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      return jsonResponse(
        await apiRequest("/bookmakers/selected/clear", {}, "PUT"),
      );
    },
  },
  {
    name: "get_leagues",
    title: "List leagues",
    description:
      "List leagues for a sport with name, slug and active event count. Call get_sports first for the sport slug; use the league slug in get_events and other tools.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        all: {
          type: "boolean",
          description: "If true, include leagues without active events",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, all } = args as { sport: string; all?: boolean };
      return listResponse(await apiRequest("/leagues", { sport, all: all || undefined }), args);
    },
  },

  // ── Events ──────────────────────────────────────────────────────

  {
    name: "get_events",
    title: "List events",
    description:
      `List events for a sport (default window: the next 14 days, max 5000 per response). Call get_sports and get_leagues first for slugs. Returns id, home, away, homeId, awayId, date, status, sport, league and scores; use the id with get_odds. Use fields (e.g. 'id,home,away,date') and limit to keep the list short. ${SCORE_KEYS_NOTE}`,
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        league: leagueProp,
        participantId: {
          type: "number",
          description: "Filter by participant/team ID (matches home or away)",
        },
        status: {
          type: "string",
          description: "One status or a comma-separated list: pending, live, settled, cancelled",
        },
        from: {
          type: "string",
          description: "Start date/time in RFC3339 format (e.g. '2026-11-07T00:00:00Z')",
        },
        to: {
          type: "string",
          description: "End date/time in RFC3339 format. Defaults to 14 days from now",
        },
        bookmaker: {
          type: "string",
          description: "Only return events with odds from this bookmaker (e.g. 'Bet365')",
        },
        limit: {
          type: "number",
          description: "Maximum number of events to return (max 5000)",
        },
        skip: {
          type: "number",
          description: "Number of events to skip for pagination",
        },
        fields: fieldsProp,
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
      return listResponse(
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
        args,
      );
    },
  },
  {
    name: "get_event",
    title: "Get event",
    description: `Get one event by ID, including scores and, when live, the match clock. ${SCORE_KEYS_NOTE}`,
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Event ID" },
      },
      required: ["id"],
    },
    async handler(args) {
      const { id } = args as { id: number };
      return jsonResponse(await apiRequest(`/events/${encodeURIComponent(String(id))}`));
    },
  },
  {
    name: "get_live_events",
    title: "List live events",
    description:
      "List events in play now with scores and the match clock, optionally for one sport. Pass sport and fields to keep the response small.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: [],
    },
    async handler(args) {
      const { sport } = args as { sport?: string };
      return listResponse(await apiRequest("/events/live", { sport }), args);
    },
  },
  {
    name: "search_events",
    title: "Search events",
    description:
      "Find events by team or league name (case- and accent-insensitive, min 3 characters). Returns up to 10 results ranked by relevance. The quickest way from a team name to an event id.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term, minimum 3 characters (e.g. 'Liverpool')",
        },
        status: {
          type: "string",
          enum: ["upcoming", "live"],
          description: "upcoming (default): not started and not cancelled. live: in-play events with current scores",
        },
      },
      required: ["query"],
    },
    async handler(args) {
      const { query, status } = args as { query: string; status?: string };
      return jsonResponse(await apiRequest("/events/search", { query, status }));
    },
  },

  // ── Odds ────────────────────────────────────────────────────────

  {
    name: "get_odds",
    title: "Get odds for an event",
    description:
      "Get odds for one event from the named bookmakers, grouped by bookmaker then market, with bet links. Always pass markets (e.g. 'ML,Spread,Totals'): without it every market from every bookmaker comes back, which can be very large. Get the event id from get_events or search_events and market names from get_markets. For best/average prices across all books, get_odds_summary is more compact.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        bookmakers: bookmakersProp,
        markets: marketsOddsProp,
      },
      required: ["eventId", "bookmakers"],
    },
    async handler(args) {
      const { eventId, bookmakers, markets } = args as {
        eventId: string;
        bookmakers: string;
        markets?: string;
      };
      return jsonResponse(await apiRequest("/odds", { eventId, bookmakers, markets }));
    },
  },
  {
    name: "get_multi_odds",
    title: "Get odds for several events",
    description:
      "Get odds for up to 10 events in one request (counts as one request). Always pass markets to keep the response small. Same shape as get_odds, as an array.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventIds: {
          type: "string",
          description: "Comma-separated event IDs (max 10)",
        },
        bookmakers: bookmakersProp,
        markets: marketsOddsProp,
      },
      required: ["eventIds", "bookmakers"],
    },
    async handler(args) {
      const { eventIds, bookmakers, markets } = args as {
        eventIds: string;
        bookmakers: string;
        markets?: string;
      };
      return jsonResponse(await apiRequest("/odds/multi", { eventIds, bookmakers, markets }));
    },
  },
  {
    name: "get_odds_summary",
    title: "Odds summary (best, average, fair)",
    description:
      "Best, average, median, worst and margin-free fair price per market line across bookmakers, with which bookmakers have the best price. The compact way to answer 'where is the best price' or 'what is the fair price'. Pass one eventId, or up to 10 comma-separated ids (one request). Growth plan and above; lower plans get a sample response marked demo: true, which is not real data, so tell the user.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "One event ID, or up to 10 comma-separated event IDs",
        },
        markets: {
          type: "string",
          description: "Comma-separated market names, case-insensitive, max 20. Default ML,Spread,Totals",
        },
        lines: {
          type: "string",
          enum: ["main", "all"],
          description: "main (default): each market's main line. all: every line priced by 3+ bookmakers",
        },
        bookmakers: {
          type: "string",
          description: "Optional: restrict to some of the key's selected bookmakers",
        },
        includeExchanges: {
          type: "boolean",
          description: "Add a separate block with the best exchange back price per outcome and its liquidity",
        },
      },
      required: ["eventId"],
    },
    async handler(args) {
      const { eventId, markets, lines, bookmakers, includeExchanges } = args as {
        eventId: string;
        markets?: string;
        lines?: string;
        bookmakers?: string;
        includeExchanges?: boolean;
      };
      const ids = splitList(String(eventId));
      const common = { markets, lines, bookmakers, includeExchanges: includeExchanges || undefined };
      if (ids.length > 1) {
        return jsonResponse(await apiRequest("/odds/summary/multi", { eventIds: ids.join(","), ...common }));
      }
      return jsonResponse(await apiRequest("/odds/summary", { eventId: ids[0] ?? eventId, ...common }));
    },
  },
  {
    name: "get_odds_movements",
    title: "Odds movements",
    description:
      "Opening price, latest price and every recorded change for one market of one event at one bookmaker (prematch only, timestamps in Unix ms). Leave marketLine out for the main line. A 404 says what is missing and lists the markets or lines that do have history; use those.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g. 'Bet365')",
        },
        market: {
          type: "string",
          description: "Market name from get_markets (e.g. 'ML', 'Spread', 'Totals')",
        },
        marketLine: {
          type: "string",
          description: "Handicap/total line (e.g. '2.5', '-1.25'). Omit for the main line or markets without a line",
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
    title: "Odds changed since",
    description:
      "Odds that changed since a Unix timestamp (at most 90 seconds old) for one bookmaker and sport, limited to the markets you name. A delta: only changed markets are returned. For polling code, not for one-off questions (use get_odds instead).",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        since: {
          type: "number",
          description: "Unix timestamp in seconds, at most 90 seconds old",
        },
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g. 'Bet365')",
        },
        sport: sportProp,
        markets: {
          type: "string",
          description:
            "Comma-separated market names, max 40 (e.g. 'ML,Spread,Totals'). Required. Use get_markets for the exact names.",
        },
        limit: {
          type: "number",
          description: "Max results, 1-10000",
        },
      },
      required: ["since", "bookmaker", "sport", "markets"],
    },
    async handler(args) {
      const { since, bookmaker, sport, markets, limit } = args as {
        since: number;
        bookmaker: string;
        sport: string;
        markets: string;
        limit?: number;
      };
      return jsonResponse(
        await apiRequest("/odds/updated", { since, bookmaker, sport, markets, limit }),
      );
    },
  },

  // ── Analysis ────────────────────────────────────────────────────

  {
    name: "get_value_bets",
    title: "Value bets",
    description:
      "Prices at one bookmaker that sit above a fair-odds estimate from market consensus, with expectedValue ((probability x odds) - 1), betSide, the bookmaker's odds and bet link. Prematch, refreshed every few seconds. Filter by sport and league and use maxResults to keep the list short. Expected value is an estimate, not a guaranteed outcome.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g. 'Bet365')",
        },
        sport: sportProp,
        league: {
          type: "string",
          description: "League slug from get_leagues. Requires sport",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include teams, date, sport and league for each row",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: ["bookmaker"],
    },
    async handler(args) {
      const { bookmaker, sport, league, includeEventDetails } = args as {
        bookmaker: string;
        sport?: string;
        league?: string;
        includeEventDetails?: boolean;
      };
      return listResponse(
        await apiRequest("/value-bets", {
          bookmaker,
          sport,
          league,
          includeEventDetails: includeEventDetails || undefined,
        }),
        args,
      );
    },
  },
  {
    name: "get_arbitrage_bets",
    title: "Arbitrage opportunities",
    description:
      "Price gaps across the named bookmakers where the best price for every outcome implies a total probability under 100%. Prematch only, sorted by profitMargin (percent, after exchange fees), with stake split (optimalStakes), stake limits (maxStake) and bet links. Prices move fast and bookmakers can void or limit bets, so present results as calculated margins at the quoted prices, never as guaranteed.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (e.g. 'Bet365,SingBet'). Every leg uses one of these",
        },
        sport: sportProp,
        league: {
          type: "string",
          description: "League slug from get_leagues. Requires sport",
        },
        markets: {
          type: "string",
          description: "Comma-separated market names, case-insensitive, max 40 (e.g. 'ML,Totals')",
        },
        minProfit: {
          type: "number",
          description: "Minimum profitMargin in percent, 0-100 (e.g. 1.5)",
        },
        allCombinations: {
          type: "boolean",
          description: "true returns every bookmaker combination per event, market and line (default: only the best)",
        },
        limit: {
          type: "number",
          description: "Maximum results (default 50, max 500)",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include teams, date, sport and league for each row",
        },
      },
      required: ["bookmakers"],
    },
    async handler(args) {
      const { bookmakers, sport, league, markets, minProfit, allCombinations, limit, includeEventDetails } = args as {
        bookmakers: string;
        sport?: string;
        league?: string;
        markets?: string;
        minProfit?: number;
        allCombinations?: boolean;
        limit?: number;
        includeEventDetails?: boolean;
      };
      return jsonResponse(
        await apiRequest("/arbitrage-bets", {
          bookmakers,
          sport,
          league,
          markets,
          minProfit,
          allCombinations: allCombinations || undefined,
          limit,
          includeEventDetails: includeEventDetails || undefined,
        }),
      );
    },
  },
  {
    name: "get_dropping_odds",
    title: "Dropping odds",
    description:
      "Odds that dropped the most from opening at sharp bookmakers, with drop percentages since opening and over 12h, 24h and 48h. Refreshed every few seconds. Paid plans. For player prop markets, market.label holds the player name. Always pass sport when the user mentions or implies one: without it results are dominated by player props.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug (e.g. 'football'). Always include it when the user mentions a sport",
        },
        league: {
          type: "string",
          description: "Single league slug. Requires sport. Mutually exclusive with leagues",
        },
        leagues: {
          type: "string",
          description: "Comma-separated league slugs (e.g. 'england-premier-league,spain-laliga'). Mutually exclusive with league",
        },
        markets: {
          type: "string",
          description:
            "Comma-separated market names, case-insensitive. Supported: ML, Spread, Totals, Spread HT, Totals HT, Totals 1Q, Spread 1Q, Team Total Home, Team Total Away, First 5 Innings ML, First 5 Innings Spread, First 5 Innings Totals, Corners Spread, Corners Totals, Corners Spread HT, Corners Totals HT, Bookings Spread, Bookings Totals, Player Props ('Player Props' covers every player prop market)",
        },
        timeWindow: {
          type: "string",
          enum: ["opening", "12h", "24h", "48h"],
          description: "Window for drop filtering and sorting (default 'opening')",
        },
        sort: {
          type: "string",
          enum: ["drop", "recent", "kickoff"],
          description: "drop (highest drop %, default), recent (latest movement) or kickoff (soonest event)",
        },
        minDrop: {
          type: "number",
          description: "Minimum drop percentage (default 0)",
        },
        limit: {
          type: "number",
          description: "Results per page, 1-200 (default 50)",
        },
        page: {
          type: "number",
          description: "Page number, 1-indexed (default 1)",
        },
        includeEventDetails: {
          type: "boolean",
          description: "Include teams, date, sport and league for each row",
        },
      },
      required: [],
    },
    async handler(args) {
      const { sport, league, leagues, markets, timeWindow, sort, minDrop, limit, page, includeEventDetails } =
        args as {
          sport?: string;
          league?: string;
          leagues?: string;
          markets?: string;
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
          markets,
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
    title: "Historical events",
    description:
      `Finished events for one sport and league in a date range (max 31 days; data from December 2025). Use the ids with get_historical_odds. To find a past match by team name use search_historical_events instead. ${SCORE_KEYS_NOTE}`,
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        league: leagueProp,
        from: {
          type: "string",
          description: "Start date in RFC3339 format (e.g. '2026-01-01T00:00:00Z')",
        },
        to: {
          type: "string",
          description: "End date in RFC3339 format, at most 31 days after from",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
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
      return listResponse(await apiRequest("/historical/events", { sport, league, from, to }), args);
    },
  },
  {
    name: "search_historical_events",
    title: "Search historical events",
    description:
      "Find finished events by team name across all leagues, optionally for one sport. Date span max 31 days (default: the last 31 days). Returns up to 100 events, newest first. Use the ids with get_historical_odds.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Team name fragment, minimum 3 characters",
        },
        sport: sportProp,
        from: {
          type: "string",
          description: "Start date in RFC3339 format",
        },
        to: {
          type: "string",
          description: "End date in RFC3339 format, at most 31 days after from",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: ["query"],
    },
    async handler(args) {
      const { query, sport, from, to } = args as {
        query: string;
        sport?: string;
        from?: string;
        to?: string;
      };
      return listResponse(await apiRequest("/historical/events/search", { query, sport, from, to }), args);
    },
  },
  {
    name: "get_historical_odds",
    title: "Historical odds",
    description:
      "Closing odds and the final score for one finished event, same shape as get_odds. Get the id from get_historical_events or search_historical_events. Pass markets to keep the response small.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventId: {
          type: "string",
          description: "Event ID of a finished event",
        },
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (max 30)",
        },
        markets: {
          type: "string",
          description: "Comma-separated market names (e.g. 'ML,Totals'). All markets when omitted",
        },
      },
      required: ["eventId", "bookmakers"],
    },
    async handler(args) {
      const { eventId, bookmakers, markets } = args as {
        eventId: string;
        bookmakers: string;
        markets?: string;
      };
      return jsonResponse(
        await apiRequest("/historical/odds", { eventId, bookmakers, markets }),
      );
    },
  },
  {
    name: "get_closing_lines",
    title: "Closing lines",
    description:
      "Closing odds for every settled event across up to 10 leagues in one request, for closing line value (CLV) and model backtests. Date range up to 366 days, so a season fits in one sweep; at most 100 events per response, page with limit and skip. Paid plans. Each event is shaped like get_historical_odds.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        leagues: {
          type: "string",
          description: "Comma-separated league slugs (max 10)",
        },
        from: {
          type: "string",
          description: "Start date in RFC3339 format",
        },
        to: {
          type: "string",
          description: "End date in RFC3339 format, at most 366 days after from",
        },
        markets: {
          type: "string",
          description: "Comma-separated market names (e.g. 'ML')",
        },
        bookmakers: {
          type: "string",
          description: "Comma-separated bookmaker names (max 30)",
        },
        limit: {
          type: "number",
          description: "Events per response (max 100)",
        },
        skip: {
          type: "number",
          description: "Events to skip, for pagination",
        },
      },
      required: ["sport", "leagues", "from", "to", "markets", "bookmakers"],
    },
    async handler(args) {
      const { sport, leagues, from, to, markets, bookmakers, limit, skip } = args as {
        sport: string;
        leagues: string;
        from: string;
        to: string;
        markets: string;
        bookmakers: string;
        limit?: number;
        skip?: number;
      };
      return jsonResponse(
        await apiRequest("/historical/closing-lines", {
          sport,
          leagues,
          from,
          to,
          markets,
          bookmakers,
          limit,
          skip,
        }),
      );
    },
  },

  // ── Settlement ──────────────────────────────────────────────────

  {
    name: "get_settlements",
    title: "Event settlements",
    description:
      `What happened in up to 50 events: status (pending, live, awaiting_result, settled, cancelled), final score by period and a final flag (true = stop polling). Unknown ids are listed in notFound. Paid plans. ${SCORE_KEYS_NOTE}`,
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        eventIds: {
          type: "string",
          description: "Comma-separated event IDs (1-50)",
        },
      },
      required: ["eventIds"],
    },
    async handler(args) {
      const { eventIds } = args as { eventIds: string };
      return jsonResponse(await apiRequest("/settlements", { eventIds }));
    },
  },
  {
    name: "grade_bets",
    title: "Grade bets",
    description:
      "Settle up to 50 bets: each is graded won, lost, void, half_won, half_lost, pending or ungradeable, with a reason, a final flag and the score it used. Describe each bet with the fields of an odds row from get_odds (market name as served, side, hdp, label). Football settles on 90 minutes. Re-send non-final selections at most once a minute. Read-only: it does not place or change anything. Paid plans.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        selections: {
          type: "array",
          maxItems: 50,
          description: "Bets to grade, described with the fields of an odds row from get_odds",
          items: {
            type: "object",
            properties: {
              eventId: { type: "number", description: "Event ID" },
              market: {
                type: "string",
                description: "Market name as served on get_odds (e.g. 'ML', 'Spread', 'Totals', 'Corners Totals', 'Player Props')",
              },
              side: {
                type: "string",
                description:
                  "home, away, draw, over, under, yes, no, odd, even, 1x, 12, x2, none, neither, or an HT/FT pair such as draw/home. Leave out for labelled markets (correct score, exact goals)",
              },
              hdp: {
                type: "number",
                description:
                  "The line as served, a multiple of 0.25. Handicaps are stated for the home side even when the bet is on away",
              },
              label: {
                type: "string",
                description: "Row label as served. Required for Player Props (e.g. 'LeBron James (Points)') and labelled markets (e.g. '2-1')",
              },
              tieRule: {
                type: "string",
                enum: ["lose", "void"],
                description: "How a level moneyline score settles in sports where bookmakers differ",
              },
              ref: { type: "string", description: "Your own id for the bet (max 64 chars), echoed back" },
            },
            required: ["eventId", "market"],
          },
        },
      },
      required: ["selections"],
    },
    async handler(args) {
      const { selections } = args as { selections: unknown[] };
      return jsonResponse(await apiRequest("/settlements/grade", {}, "POST", { selections }));
    },
  },

  // ── Outrights ───────────────────────────────────────────────────

  {
    name: "list_outrights",
    title: "List outright tournaments",
    description:
      "List outright (futures) tournaments for a sport, sorted by date: id, name, date, status, league and bookmakerCount (0 = not priced yet). Golf only today: PGA Tour, DP World Tour, LIV Golf and the majors. Call this first, then get_outright_odds with the id. Needs the Outrights add-on: a 403 means the key does not have it, so tell the user the message (it links to where to add it) and do not retry.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: {
          type: "string",
          description: "Sport slug. Currently 'golf'",
        },
        league: {
          type: "string",
          description: "League slug: pga-tour, dp-world-tour, liv-golf or majors",
        },
        status: {
          type: "string",
          description: "Comma-separated: pending, live, settled, cancelled. Default pending,live",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, league, status } = args as { sport: string; league?: string; status?: string };
      return listResponse(await apiRequest("/outrights", { sport, league, status }), args);
    },
  },
  {
    name: "get_outright_odds",
    title: "Outright odds",
    description:
      "Prices for one outright tournament from the named bookmakers. Golf markets: Winner, Top 5, Top 10, Top 20 (boundary ties under dead-heat rules), Top 5 (Incl. Ties), Top 10 (Incl. Ties), Top 20 (Incl. Ties) (ties paid in full) and Make Cut (only events with a cut). Runners carry label, participantId and odds (+ layOdds on exchanges), or yes/no for Make Cut, sorted shortest price first. A full field is large: pass markets and maxRunners. Needs the Outrights add-on: a 403 means the key does not have it, so tell the user the message and do not retry.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Outright id from list_outrights",
        },
        bookmakers: bookmakersProp,
        markets: {
          type: "string",
          description:
            "Optional comma-separated market names to keep, e.g. 'Winner,Top 10 (Incl. Ties)' (filtered after the call)",
        },
        maxRunners: {
          type: "number",
          description: "Optional: keep only the first N runners (shortest prices) per market",
        },
      },
      required: ["id", "bookmakers"],
    },
    async handler(args) {
      const { id, bookmakers } = args as { id: number; bookmakers: string };
      return jsonResponse(filterOutrightOdds(await apiRequest("/outrights/odds", { id, bookmakers }), args));
    },
  },
  {
    name: "get_outright_results",
    title: "Outright results",
    description:
      "Final results for one outright tournament: each golfer's position (shared when tied, null when cut, withdrawn or disqualified), madeCut and status, plus winners per market (Winner, Top N, Top N (Incl. Ties), Make Cut). Empty until the tournament is settled. Dead-heat and each-way terms are the bookmaker's rules. Needs the Outrights add-on (403 without it: tell the user, do not retry).",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "number",
          description: "Outright id from list_outrights",
        },
      },
      required: ["id"],
    },
    async handler(args) {
      const { id } = args as { id: number };
      return jsonResponse(await apiRequest("/outrights/results", { id }));
    },
  },

  // ── Participants ────────────────────────────────────────────────

  {
    name: "get_participants",
    title: "List participants",
    description:
      "Teams or players for a sport, optionally filtered by name. Returns id and name (esports also game and shortCode). Use the id as participantId in get_events.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        sport: sportProp,
        search: {
          type: "string",
          description: "Filter by team/participant name",
        },
        fields: fieldsProp,
        maxResults: maxResultsProp,
      },
      required: ["sport"],
    },
    async handler(args) {
      const { sport, search } = args as { sport: string; search?: string };
      return listResponse(await apiRequest("/participants", { sport, search }), args);
    },
  },
  {
    name: "get_participant",
    title: "Get participant",
    description: "Get one team or player by ID.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Participant ID (homeId/awayId on events)" },
      },
      required: ["id"],
    },
    async handler(args) {
      const { id } = args as { id: number };
      return jsonResponse(await apiRequest(`/participants/${encodeURIComponent(String(id))}`));
    },
  },

  // ── Mappings ────────────────────────────────────────────────────

  {
    name: "get_mappings",
    title: "Bookmaker id mappings",
    description:
      "Map our events and selections to a bookmaker's own event, market and outcome ids (for example Polymarket conditionId and token id, or Kalshi tickers), joinable to get_odds on (eventId, market, hdp, side). Look up by eventId(s), marketId(s) or outcomeId; with none of these it is a bulk sync of upcoming and live events, paged with cursor until nextCursor is null. Paid plans; the bookmaker must be in the key's selection.",
    annotations: READ_ONLY,
    inputSchema: {
      type: "object",
      properties: {
        bookmaker: {
          type: "string",
          description: "Bookmaker name (e.g. 'Polymarket', 'Kalshi')",
        },
        eventId: { type: "string", description: "One of our event ids" },
        eventIds: { type: "string", description: "Up to 10 comma-separated event ids" },
        marketId: { type: "string", description: "The bookmaker's market id" },
        marketIds: { type: "string", description: "Up to 10 comma-separated bookmaker market ids" },
        outcomeId: { type: "string", description: "The bookmaker's outcome id (for Kalshi pass marketId too)" },
        market: { type: "string", description: "Exact market name as in get_odds, case-sensitive" },
        active: { type: "boolean", description: "true or false; both when omitted" },
        sport: { type: "string", description: "Bulk sync only: sport slug" },
        league: { type: "string", description: "Bulk sync only: league slug, requires sport" },
        limit: { type: "number", description: "Bulk sync only: rows per page, 1-5000 (default 1000)" },
        cursor: { type: "string", description: "Bulk sync only: nextCursor from the previous page" },
        fields: fieldsProp,
      },
      required: ["bookmaker"],
    },
    async handler(args) {
      const { bookmaker, eventId, eventIds, marketId, marketIds, outcomeId, market, active, sport, league, limit, cursor } =
        args as {
          bookmaker: string;
          eventId?: string;
          eventIds?: string;
          marketId?: string;
          marketIds?: string;
          outcomeId?: string;
          market?: string;
          active?: boolean;
          sport?: string;
          league?: string;
          limit?: number;
          cursor?: string;
        };
      return listResponse(
        await apiRequest("/mappings", {
          bookmaker,
          eventId,
          eventIds,
          marketId,
          marketIds,
          outcomeId,
          market,
          active,
          sport,
          league,
          limit,
          cursor,
        }),
        args,
      );
    },
  },

  // ── Account and reference ───────────────────────────────────────

  {
    name: "get_usage",
    title: "Request quota",
    description:
      "Hourly request limit, requests remaining and reset time for this API key, read from the rate-limit headers of the latest API call in this session. If no call has been made yet it calls get_sports once, which counts as one request. Use it to plan bulk work or to explain a 429.",
    annotations: READ_ONLY,
    inputSchema: { type: "object", properties: {}, required: [] },
    async handler() {
      let source = "latest API call this session";
      if (!lastRateLimit) {
        await apiRequest("/sports");
        source = "a get_sports call made just now";
      }
      if (!lastRateLimit) {
        return textResponse("The API did not return rate-limit headers for this key.");
      }
      return jsonResponse({ ...lastRateLimit, source });
    },
  },
  {
    name: "get_documentation",
    title: "API documentation",
    description:
      "Fetch the complete Odds-API.io documentation as plain text (large). Use it for questions the tool descriptions do not answer, such as WebSocket details or market rules.",
    annotations: READ_ONLY,
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

// ── Prompts ──────────────────────────────────────────────────────────────────

interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  arguments: Array<{ name: string; description: string; required: boolean }>;
  render(args: Record<string, string>): string;
}

const prompts: PromptDefinition[] = [
  {
    name: "compare_odds",
    title: "Compare odds for a match",
    description: "Find a match and compare prices across bookmakers",
    arguments: [
      { name: "match", description: "Team or match, e.g. 'Arsenal v Chelsea'", required: true },
      { name: "markets", description: "Markets to compare, default ML,Spread,Totals", required: false },
    ],
    render: ({ match, markets }) =>
      `Compare odds for ${match}. Use search_events to find the event id, get_selected_bookmakers for the bookmakers on my key and get_markets if you are unsure of market names. Then call get_odds with markets=${markets || "ML,Spread,Totals"} (or get_odds_summary for best and fair prices). Show the best price per outcome with the bookmaker and the time it was updated.`,
  },
  {
    name: "settle_bets",
    title: "Settle my bets",
    description: "Grade a list of bets against final results",
    arguments: [
      { name: "bets", description: "The bets, one per line (match, market, selection, line)", required: true },
    ],
    render: ({ bets }) =>
      `Settle these bets:\n${bets}\n\nFind each event id with search_historical_events (finished) or search_events, check market names with get_markets, then call grade_bets once with all selections. Report won, lost, void, half_won, half_lost, pending or ungradeable per bet with the reason, and say which are not final yet.`,
  },
  {
    name: "golf_outrights",
    title: "Golf outright prices",
    description: "Show golf tournament odds for a market",
    arguments: [
      { name: "tournament", description: "Tournament name, or leave empty for the next one", required: false },
      { name: "market", description: "Winner, Top 5/10/20, Top N (Incl. Ties) or Make Cut. Default Winner", required: false },
    ],
    render: ({ tournament, market }) =>
      `Show ${market || "Winner"} prices for ${tournament || "the next golf tournament"}. Call list_outrights with sport=golf to find the id, then get_outright_odds with markets=${market || "Winner"} and maxRunners=15 for the bookmakers on my key. If a call returns 403, tell me what it says about the Outrights add-on instead of retrying.`,
  },
];

// ── Agent guide ──────────────────────────────────────────────────────────────

function readGuide(): string {
  try {
    return readFileSync(new URL("../skills/odds-api/SKILL.md", import.meta.url), "utf8");
  } catch {
    return SERVER_INSTRUCTIONS;
  }
}

// ── Server Setup ─────────────────────────────────────────────────────────────

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

const mcpServer = new McpServer(
  { name: SERVER_NAME, version: SERVER_VERSION },
  { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: SERVER_INSTRUCTIONS },
);
const server = mcpServer.server;

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, title, description, inputSchema, annotations }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { title, ...annotations },
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

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: prompts.map(({ name, title, description, arguments: promptArgs }) => ({
    name,
    title,
    description,
    arguments: promptArgs,
  })),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = prompts.find((p) => p.name === request.params.name);
  if (!prompt) throw new Error(`Unknown prompt: ${request.params.name}`);
  const args = (request.params.arguments ?? {}) as Record<string, string>;
  for (const arg of prompt.arguments) {
    if (arg.required && !args[arg.name]) throw new Error(`Missing argument: ${arg.name}`);
  }
  return {
    description: prompt.description,
    messages: [{ role: "user" as const, content: { type: "text" as const, text: prompt.render(args) } }],
  };
});

// ── Resources ────────────────────────────────────────────────────────────────

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "odds-api://guide",
      name: "Agent guide",
      description: "Call order, caching, quotas and error handling for this server",
      mimeType: "text/markdown",
    },
    {
      uri: "odds-api://documentation",
      name: "Odds-API.io Documentation",
      description: "Complete API documentation for Odds-API.io",
      mimeType: "text/plain",
    },
    {
      uri: "odds-api://openapi",
      name: "OpenAPI Specification",
      description: "OpenAPI specification for Odds-API.io",
      mimeType: "application/json",
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "odds-api://guide":
      return { contents: [{ uri, mimeType: "text/markdown", text: readGuide() }] };
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
            text: JSON.stringify(await response.json()),
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
  await mcpServer.connect(transport);
  console.error("Odds-API.io MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", redact(String(error)));
  process.exit(1);
});

// ── Exports (for testing) ────────────────────────────────────────────────────

export {
  tools,
  toolMap,
  prompts,
  apiRequest,
  jsonResponse,
  textResponse,
  errorResponse,
  shapeList,
  filterOutrightOdds,
  redact,
  getLastRateLimit,
  resetRateLimit,
  SERVER_NAME,
  SERVER_VERSION,
  API_BASE_URL,
};
