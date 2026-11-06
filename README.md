# Odds-API.io MCP Server

[![npm version](https://img.shields.io/npm/v/odds-api-mcp-server)](https://www.npmjs.com/package/odds-api-mcp-server) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP server for the [Odds-API.io](https://odds-api.io) sports betting odds API. It gives Claude, Cursor, VS Code and other AI agents live and pre-match odds from 450+ bookmakers across 34 sports, plus value bets, arbitrage and dropping odds.

## Quickstart

1. Get an API key at [odds-api.io/pricing](https://odds-api.io/pricing?ref=npm).
2. Add the server to Claude Code:

   ```bash
   claude mcp add odds-api --env ODDS_API_KEY="your-api-key" -- npx -y odds-api-mcp-server
   ```

3. Ask: "Show me upcoming Premier League matches with Bet365 odds."

Setup for Claude Desktop, Cursor and VS Code is below.

## Get an API key

The server needs an Odds-API.io API key from a paid plan. Pick a plan at [odds-api.io/pricing](https://odds-api.io/pricing?ref=npm), then pass the key as the `ODDS_API_KEY` environment variable.

Full AI-tooling docs: [docs.odds-api.io/ai-vibe-coding](https://docs.odds-api.io/ai-vibe-coding)

## Features

- **25 API tools** covering the full Odds-API.io v3 surface: sports, events, odds, historical data, bet settlement, value bets, arbitrage, dropping odds, and more
- **Documentation resources** for AI context
- **Real-time odds** from 450+ bookmakers across 34 sports, including Bet365, DraftKings, FanDuel and Betfair

## Install in your client

### One-Click Install (Claude Desktop)

Download the latest `.mcpb` file from [Releases](https://github.com/odds-api-io/odds-api-mcp-server/releases/latest) and open it. Claude Desktop will prompt you for your API key.

### Claude Code CLI

```bash
claude mcp add odds-api --env ODDS_API_KEY="your-api-key" -- npx -y odds-api-mcp-server
```

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS, `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

```json
{
  "mcpServers": {
    "odds-api": {
      "command": "npx",
      "args": ["-y", "odds-api-mcp-server"],
      "env": {
        "ODDS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Cursor

Add to your Cursor MCP settings (`.cursor/mcp.json` in your project or global config):

```json
{
  "mcpServers": {
    "odds-api": {
      "command": "npx",
      "args": ["-y", "odds-api-mcp-server"],
      "env": {
        "ODDS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### VS Code

Add to your VS Code settings (`.vscode/mcp.json`):

```json
{
  "servers": {
    "odds-api": {
      "command": "npx",
      "args": ["-y", "odds-api-mcp-server"],
      "env": {
        "ODDS_API_KEY": "your-api-key"
      }
    }
  }
}
```

### Global Install (alternative)

```bash
npm install -g odds-api-mcp-server
```

Then use `odds-api-mcp-server` as the command instead of `npx -y odds-api-mcp-server`.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ODDS_API_KEY` | Yes | Your API key from a paid plan at [odds-api.io/pricing](https://odds-api.io/pricing?ref=npm) |

## Available Tools

### Sports & Leagues

| Tool | Description |
|------|-------------|
| `get_sports` | List all available sports with slugs |
| `get_leagues` | Get leagues for a sport (with optional `all` flag for inactive leagues) |
| `get_markets` | List the exact market names a sport serves, with shape, period and prematch/live availability |

### Bookmakers

| Tool | Description |
|------|-------------|
| `get_bookmakers` | List all supported bookmakers |
| `get_selected_bookmakers` | Get your currently selected bookmakers |
| `select_bookmakers` | Add bookmakers to your selection |
| `clear_selected_bookmakers` | Clear all selected bookmakers (once per 12h) |

### Events

| Tool | Description |
|------|-------------|
| `get_events` | Get events with filtering (league, status, date range, participant, bookmaker, pagination) |
| `get_event` | Get a single event by ID |
| `get_live_events` | Get currently live events |
| `search_events` | Search events by team name or text |

### Odds

| Tool | Description |
|------|-------------|
| `get_odds` | Get odds for an event from selected bookmakers |
| `get_multi_odds` | Get odds for up to 10 events in one call |
| `get_odds_movements` | Get historical line movements for a market |
| `get_updated_odds` | Get recently changed odds (polling), for the markets you name |

### Historical

| Tool | Description |
|------|-------------|
| `get_historical_events` | Get finished events for a sport/league/date range |
| `get_historical_odds` | Get closing odds and scores for finished events |

### Betting Analytics

| Tool | Description |
|------|-------------|
| `get_settlements` | Status, final score and `final` flag for up to 50 events |
| `grade_bets` | Settle up to 50 bets as won, lost, void, half won or half lost |
| `get_value_bets` | Get positive EV opportunities for a bookmaker |
| `get_arbitrage_bets` | Get arbitrage opportunities with optimal stakes |
| `get_dropping_odds` | Track sharp bookmaker line movements by sport, league, market, and time window |

### Participants

| Tool | Description |
|------|-------------|
| `get_participants` | Get teams/participants for a sport |
| `get_participant` | Get a single participant by ID |

### Reference

| Tool | Description |
|------|-------------|
| `get_documentation` | Fetch full API documentation |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `odds-api://documentation` | Complete API documentation |
| `odds-api://openapi` | OpenAPI/Swagger specification |

## Example Usage

Once configured, ask your AI assistant things like:

- "What sports are available on Odds-API?"
- "Show me upcoming Premier League matches"
- "Get odds for the next Arsenal match from Bet365 and SingBet"
- "Find value bets on Bet365 with event details"
- "Are there any arbitrage opportunities between Bet365 and Unibet?"
- "Show me how the odds moved for event 12345 on the spread market"
- "Get historical results for La Liga in January 2026"
- "Show me the biggest dropping odds in football right now"
- "What Premier League odds have dropped the most in the last 12 hours?"

## Development

```bash
git clone https://github.com/odds-api-io/odds-api-mcp-server
cd odds-api-mcp-server
npm install
npm run build
npm test
```

## License

MIT

## Links

- [Odds-API.io](https://odds-api.io) - Main website
- [Documentation](https://docs.odds-api.io) - API docs
- [API Reference](https://api.odds-api.io/v3/docs/index.html) - Swagger/OpenAPI
- [npm](https://www.npmjs.com/package/odds-api-mcp-server) - Package registry
