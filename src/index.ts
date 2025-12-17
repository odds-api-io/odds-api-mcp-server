#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

const API_BASE_URL = "https://api2.odds-api.io/v3";
const DOCS_BASE_URL = "https://docs.odds-api.io";

// Get API key from environment
const API_KEY = process.env.ODDS_API_KEY || "";

if (!API_KEY) {
  console.error("Error: ODDS_API_KEY environment variable is required");
  process.exit(1);
}

// Helper function to make API requests
async function apiRequest(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`${API_BASE_URL}${endpoint}`);
  url.searchParams.set("apiKey", API_KEY);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API request failed: ${response.status} - ${error}`);
  }

  return response.json();
}

// Create the MCP server
const server = new Server(
  {
    name: "odds-api-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// Define tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_sports",
        description: "Get list of all available sports. Returns sport name and slug for each sport.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_bookmakers",
        description: "Get list of all available bookmakers. Returns bookmaker name and active status.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "get_leagues",
        description: "Get leagues for a specific sport. Returns league name, slug, and event count.",
        inputSchema: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Sport slug (e.g., 'football', 'basketball', 'tennis')",
            },
          },
          required: ["sport"],
        },
      },
      {
        name: "get_events",
        description: "Get events for a sport, optionally filtered by league, status, or date range.",
        inputSchema: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Sport slug (e.g., 'football', 'basketball')",
            },
            league: {
              type: "string",
              description: "Optional league slug (e.g., 'england-premier-league')",
            },
            status: {
              type: "string",
              description: "Optional comma-separated statuses (pending, live, settled)",
            },
          },
          required: ["sport"],
        },
      },
      {
        name: "get_live_events",
        description: "Get all currently live events, optionally filtered by sport.",
        inputSchema: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Optional sport slug to filter live events",
            },
          },
          required: [],
        },
      },
      {
        name: "search_events",
        description: "Search events by team name or other text. Returns up to 10 matching events.",
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
      },
      {
        name: "get_odds",
        description: "Get betting odds for a specific event from selected bookmakers.",
        inputSchema: {
          type: "object",
          properties: {
            eventId: {
              type: "string",
              description: "Event ID",
            },
            bookmakers: {
              type: "string",
              description: "Comma-separated list of bookmaker names (e.g., 'Bet365,Pinnacle,Unibet')",
            },
          },
          required: ["eventId", "bookmakers"],
        },
      },
      {
        name: "get_multi_odds",
        description: "Get odds for multiple events in a single request (up to 10 events). Counts as 1 API call.",
        inputSchema: {
          type: "object",
          properties: {
            eventIds: {
              type: "string",
              description: "Comma-separated list of event IDs (max 10)",
            },
            bookmakers: {
              type: "string",
              description: "Comma-separated list of bookmaker names",
            },
          },
          required: ["eventIds", "bookmakers"],
        },
      },
      {
        name: "get_value_bets",
        description: "Get value betting opportunities for a specific bookmaker. Returns bets where expected value is positive.",
        inputSchema: {
          type: "object",
          properties: {
            bookmaker: {
              type: "string",
              description: "Bookmaker name (e.g., 'Bet365')",
            },
            includeEventDetails: {
              type: "boolean",
              description: "Include full event details in response",
            },
          },
          required: ["bookmaker"],
        },
      },
      {
        name: "get_arbitrage_bets",
        description: "Get arbitrage betting opportunities across specified bookmakers.",
        inputSchema: {
          type: "object",
          properties: {
            bookmakers: {
              type: "string",
              description: "Comma-separated list of bookmaker names",
            },
            limit: {
              type: "number",
              description: "Maximum number of results (default 50, max 500)",
            },
            includeEventDetails: {
              type: "boolean",
              description: "Include full event details in response",
            },
          },
          required: ["bookmakers"],
        },
      },
      {
        name: "get_participants",
        description: "Get teams/participants for a sport, optionally filtered by search term.",
        inputSchema: {
          type: "object",
          properties: {
            sport: {
              type: "string",
              description: "Sport slug (e.g., 'football')",
            },
            search: {
              type: "string",
              description: "Optional search term to filter by name",
            },
          },
          required: ["sport"],
        },
      },
      {
        name: "get_documentation",
        description: "Get Odds-API.io documentation. Returns the full documentation text.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_sports": {
        const data = await apiRequest("/sports");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_bookmakers": {
        const data = await apiRequest("/bookmakers");
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_leagues": {
        const params = args as { sport: string };
        const data = await apiRequest("/leagues", { sport: params.sport });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_events": {
        const params = args as { sport: string; league?: string; status?: string };
        const data = await apiRequest("/events", {
          sport: params.sport,
          league: params.league || "",
          status: params.status || "",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_live_events": {
        const params = args as { sport?: string };
        const data = await apiRequest("/events/live", {
          sport: params.sport || "",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "search_events": {
        const params = args as { query: string };
        const data = await apiRequest("/events/search", { query: params.query });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_odds": {
        const params = args as { eventId: string; bookmakers: string };
        const data = await apiRequest("/odds", {
          eventId: params.eventId,
          bookmakers: params.bookmakers,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_multi_odds": {
        const params = args as { eventIds: string; bookmakers: string };
        const data = await apiRequest("/odds/multi", {
          eventIds: params.eventIds,
          bookmakers: params.bookmakers,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_value_bets": {
        const params = args as { bookmaker: string; includeEventDetails?: boolean };
        const data = await apiRequest("/value-bets", {
          bookmaker: params.bookmaker,
          includeEventDetails: params.includeEventDetails ? "true" : "false",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_arbitrage_bets": {
        const params = args as { bookmakers: string; limit?: number; includeEventDetails?: boolean };
        const data = await apiRequest("/arbitrage-bets", {
          bookmakers: params.bookmakers,
          limit: params.limit?.toString() || "",
          includeEventDetails: params.includeEventDetails ? "true" : "false",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_participants": {
        const params = args as { sport: string; search?: string };
        const data = await apiRequest("/participants", {
          sport: params.sport,
          search: params.search || "",
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
        };
      }

      case "get_documentation": {
        const response = await fetch(`${DOCS_BASE_URL}/llms-full.txt`);
        const text = await response.text();
        return {
          content: [{ type: "text", text }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
});

// Define resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
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
  };
});

// Handle resource reads
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;

  switch (uri) {
    case "odds-api://documentation": {
      const response = await fetch(`${DOCS_BASE_URL}/llms-full.txt`);
      const text = await response.text();
      return {
        contents: [{ uri, mimeType: "text/plain", text }],
      };
    }

    case "odds-api://openapi": {
      const response = await fetch(`${DOCS_BASE_URL}/api-reference/openapi.json`);
      const json = await response.json();
      return {
        contents: [{ uri, mimeType: "application/json", text: JSON.stringify(json, null, 2) }],
      };
    }

    default:
      throw new Error(`Unknown resource: ${uri}`);
  }
});

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Odds-API.io MCP Server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
