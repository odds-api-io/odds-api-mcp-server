MCP server that gives Claude, Cursor, VS Code and other AI tools direct access to real-time sports betting odds from Odds-API.io: 265+ bookmakers, 34 sports, 12,000+ leagues, plus value bets, arbitrage and dropping odds.

## Quick start

The server speaks MCP over stdio, so run it with `-i` and pass your API key as an environment variable:

```bash
docker run -i --rm -e ODDS_API_KEY=your-api-key oddsapi/odds-api-mcp-server
```

Get a key at https://odds-api.io.

## Claude Desktop

Add to `claude_desktop_config.json` (`~/Library/Application Support/Claude/` on macOS, `%APPDATA%\Claude\` on Windows):

```json
{
  "mcpServers": {
    "odds-api": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "ODDS_API_KEY", "oddsapi/odds-api-mcp-server"],
      "env": {
        "ODDS_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Cursor

Add the same block to `.cursor/mcp.json` in your project or your global Cursor MCP settings:

```json
{
  "mcpServers": {
    "odds-api": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-e", "ODDS_API_KEY", "oddsapi/odds-api-mcp-server"],
      "env": {
        "ODDS_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Tools

22 tools covering the full Odds-API.io v3 surface: sports, leagues, bookmakers, events, live events, search, per-event odds, multi-event odds, odds movements, updated odds, historical events and odds, value bets, arbitrage bets, dropping odds and participants.

## Links

- Website: https://odds-api.io
- AI and vibe coding guide: https://docs.odds-api.io/ai-vibe-coding
- Source and issues: https://github.com/odds-api-io/odds-api-mcp-server
- npm: https://www.npmjs.com/package/odds-api-mcp-server

Free tier: 100 requests/hour, no credit card required.
