# Odds-API.io MCP Server

Model Context Protocol (MCP) server for [Odds-API.io](https://odds-api.io) - providing AI tools like Claude, Cursor, and VS Code with direct access to sports betting odds data.

## Features

- **21 API tools** covering the full Odds-API.io v3 surface: sports, events, odds, historical data, value bets, arbitrage, and more
- **Documentation resources** for AI context
- **Real-time data** from 265+ bookmakers across 34 sports

## Quick Start

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

Then use `odds-api-mcp` as the command instead of `npx -y odds-api-mcp-server`.

## Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `ODDS_API_KEY` | Yes | Your API key from [odds-api.io](https://odds-api.io) |

## Available Tools

### Sports & Leagues

| Tool | Description |
|------|-------------|
| `get_sports` | List all available sports with slugs |
| `get_leagues` | Get leagues for a sport (with optional `all` flag for inactive leagues) |

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
| `get_updated_odds` | Get recently changed odds (polling) |

### Historical

| Tool | Description |
|------|-------------|
| `get_historical_events` | Get finished events for a sport/league/date range |
| `get_historical_odds` | Get closing odds and scores for finished events |

### Betting Analytics

| Tool | Description |
|------|-------------|
| `get_value_bets` | Get positive EV opportunities for a bookmaker |
| `get_arbitrage_bets` | Get arbitrage opportunities with optimal stakes |

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
- "Get odds for the next Arsenal match from Bet365 and Pinnacle"
- "Find value bets on Bet365 with event details"
- "Are there any arbitrage opportunities between Bet365 and Unibet?"
- "Show me how the odds moved for event 12345 on the spread market"
- "Get historical results for La Liga in January 2026"

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
