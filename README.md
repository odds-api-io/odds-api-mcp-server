# Odds-API.io MCP Server

Model Context Protocol (MCP) server for [Odds-API.io](https://odds-api.io) - providing AI tools like Claude, Cursor, and VS Code with direct access to sports betting odds data.

## Features

- **12 API tools** for fetching sports, bookmakers, events, odds, value bets, and arbitrage opportunities
- **Documentation resources** for AI context
- **Real-time data** from 265 bookmakers across 34 sports

## Installation

### Claude Code CLI

```bash
claude mcp add odds-api --env ODDS_API_KEY="your-api-key" -- npx -y odds-api-mcp-server
```

### Manual Installation

```bash
npm install -g odds-api-mcp-server
```

### From Source

```bash
git clone https://github.com/odds-api-io/odds-api-mcp-server
cd odds-api-mcp-server
npm install
npm run build
```

## Configuration

### Environment Variables

- `ODDS_API_KEY` (required): Your Odds-API.io API key

Get your API key at [odds-api.io](https://odds-api.io).

### Claude Desktop

Add to your Claude Desktop config (`~/.config/claude/claude_desktop_config.json` on macOS/Linux or `%APPDATA%\Claude\claude_desktop_config.json` on Windows):

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

Add to your Cursor MCP settings:

```json
{
  "odds-api": {
    "command": "npx",
    "args": ["-y", "odds-api-mcp-server"],
    "env": {
      "ODDS_API_KEY": "your-api-key"
    }
  }
}
```

## Available Tools

| Tool | Description |
|------|-------------|
| `get_sports` | List all available sports |
| `get_bookmakers` | List all available bookmakers |
| `get_leagues` | Get leagues for a sport |
| `get_events` | Get events with filtering options |
| `get_live_events` | Get currently live events |
| `search_events` | Search events by text |
| `get_odds` | Get odds for an event |
| `get_multi_odds` | Get odds for multiple events (batch) |
| `get_value_bets` | Get value betting opportunities |
| `get_arbitrage_bets` | Get arbitrage opportunities |
| `get_participants` | Get teams/participants |
| `get_documentation` | Get API documentation |

## Available Resources

| Resource | Description |
|----------|-------------|
| `odds-api://documentation` | Full API documentation |
| `odds-api://openapi` | OpenAPI specification |

## Example Usage

Once configured, you can ask your AI assistant:

- "Get me the list of available sports"
- "Show me upcoming Premier League matches"
- "Find value bets for Bet365 with expected value above 3%"
- "Search for events involving Liverpool"
- "Get odds for event 123456 from Pinnacle and Bet365"

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in development mode
npm run dev
```

## License

MIT

## Links

- [Odds-API.io](https://odds-api.io) - Main website
- [Documentation](https://docs.odds-api.io) - API documentation
- [Support](mailto:hello@odds-api.io) - Email support
