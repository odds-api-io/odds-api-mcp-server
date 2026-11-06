# Odds-API.io MCP Server

[![npm version](https://img.shields.io/npm/v/odds-api-mcp-server)](https://www.npmjs.com/package/odds-api-mcp-server) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

MCP server for the [Odds-API.io](https://odds-api.io) sports betting odds API. It gives Claude, Cursor, VS Code and other AI agents live and pre-match odds from 450+ bookmakers across 34 sports, plus odds summaries, closing lines, bet settlement, golf outrights, value bets, arbitrage and dropping odds.

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

- **33 tools covering every public Odds-API.io v3 REST endpoint**: sports, markets, events, odds, odds summaries, line movements, value bets, arbitrage, dropping odds, historical events and odds, closing lines, bet settlement, golf outrights, participants, bookmaker id mappings and request quota. The WebSocket stream and the participant logo image are not tools; use the REST equivalents.
- **Built for agents**: every tool says what to call first, what plan or add-on it needs and what it returns. Read tools carry `readOnlyHint`; only `select_bookmakers` and `clear_selected_bookmakers` change anything.
- **Small responses**: compact JSON, a `markets` filter on every odds tool, and `fields` / `maxResults` on list tools.
- **Clear errors**: a 403 (missing plan or add-on) or 429 (hourly limit) comes back with the API's own message and an instruction not to retry blindly.
- **Key safety**: the key is read from `ODDS_API_KEY` only. No tool takes it as an argument, and it is masked as `***` in every output and error.
- **Agent guide** in [`skills/odds-api/SKILL.md`](skills/odds-api/SKILL.md): call order, caching, quotas and 429 handling. Also served as the `odds-api://guide` resource and, in short form, as the server's `instructions`.

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

Requests go to `https://api.odds-api.io/v3`. Each tool call is one API request against your hourly limit (multi-event tools count as one).

## Available Tools

### Catalogue

| Tool | Description |
|------|-------------|
| `get_sports` | List sports and their slugs. Call first |
| `get_leagues` | Leagues for a sport (`all` includes leagues without events) |
| `get_markets` | Exact market names per sport, with shape, period and prematch/live flags |
| `get_bookmakers` | All bookmakers with `status` (ok, degraded, down) and `reason` |
| `get_selected_bookmakers` | Bookmakers selected on your key |
| `select_bookmakers` | Add bookmakers to your selection (writes) |
| `clear_selected_bookmakers` | Clear your selection, once per 12h (destructive) |

### Events

| Tool | Description |
|------|-------------|
| `get_events` | Events with league, status (pending, live, settled, cancelled), date, participant and bookmaker filters, `limit`/`skip` |
| `get_event` | One event with scores and live clock |
| `get_live_events` | Events in play now |
| `search_events` | Search by team or league name, `status` upcoming or live |

### Odds

| Tool | Description |
|------|-------------|
| `get_odds` | Odds for one event; pass `markets` (max 40) to keep it small |
| `get_multi_odds` | Odds for up to 10 events in one request, with `markets` |
| `get_odds_summary` | Best, average, median, worst and fair price per line across bookmakers, for one or up to 10 events (Growth plan and above) |
| `get_odds_movements` | Opening, latest and every change for one market at one bookmaker |
| `get_updated_odds` | Odds changed since a timestamp, for named markets (max 40), with `limit` |

### Analysis

| Tool | Description |
|------|-------------|
| `get_value_bets` | Prices above a fair-odds estimate for a bookmaker, by sport and league |
| `get_arbitrage_bets` | Arbitrage across your bookmakers with `sport`, `league`, `markets`, `minProfit`, `allCombinations` |
| `get_dropping_odds` | Biggest drops at sharp bookmakers by sport, league, market and time window |

### Historical and closing lines

| Tool | Description |
|------|-------------|
| `get_historical_events` | Finished events for a league and date range |
| `search_historical_events` | Finished events by team name |
| `get_historical_odds` | Closing odds and final score for one event, with `markets` |
| `get_closing_lines` | Closing odds for every settled event across up to 10 leagues and 366 days |

### Settlement

| Tool | Description |
|------|-------------|
| `get_settlements` | Status, final score and `final` flag for up to 50 events |
| `grade_bets` | Grade up to 50 bets as won, lost, void, half won, half lost, pending or ungradeable |

### Outrights (golf)

| Tool | Description |
|------|-------------|
| `list_outrights` | Tournaments for a sport (golf: PGA Tour, DP World Tour, LIV Golf, majors) |
| `get_outright_odds` | Winner, Top 5/10/20, Top N (Incl. Ties) and Make Cut odds, with `markets` and `maxRunners` filters |
| `get_outright_results` | Positions, cut status and winners per market |

### Participants and mappings

| Tool | Description |
|------|-------------|
| `get_participants` | Teams or players for a sport |
| `get_participant` | One team or player by ID |
| `get_mappings` | Our events and selections mapped to bookmaker ids (Polymarket, Kalshi), lookup or bulk sync with cursor |

### Account and reference

| Tool | Description |
|------|-------------|
| `get_usage` | Hourly request limit, remaining requests and reset time |
| `get_documentation` | Fetch the full API documentation |

## Outrights

Golf outright odds and results are the Outrights add-on on paid plans. Call `list_outrights` with `sport: "golf"` for tournament ids, then `get_outright_odds` with the id and your bookmakers. Markets: `Winner`, `Top 5`, `Top 10`, `Top 20` (boundary ties under the bookmaker's dead-heat rules), `Top 5 (Incl. Ties)`, `Top 10 (Incl. Ties)`, `Top 20 (Incl. Ties)` (ties paid in full) and `Make Cut` (only for events with a cut). A full field is 150+ golfers per market, so pass `markets` and `maxRunners`. `get_outright_results` lists every golfer's position and the winners per market once the tournament is settled.

Without the add-on the API answers 403 with a link to enable it; the server passes that message through and tells the agent to relay it rather than retry.

## Closing lines

`get_closing_lines` returns closing odds for every settled event across up to 10 leagues in one request, over up to 366 days, so a season fits in one sweep (100 events per response; page with `limit` and `skip`). Use it for closing line value (CLV) and model backtests. For a single match use `search_historical_events` and `get_historical_odds`. Paid plans.

## Prompts

| Prompt | Description |
|--------|-------------|
| `compare_odds` | Find a match and compare prices across your bookmakers |
| `settle_bets` | Grade a list of bets against final results |
| `golf_outrights` | Show golf tournament prices for a market |

## Resources

| Resource URI | Description |
|-------------|-------------|
| `odds-api://guide` | Agent guide: call order, caching, quotas, errors |
| `odds-api://documentation` | Complete API documentation |
| `odds-api://openapi` | OpenAPI specification |

## Example Usage

Once configured, ask your AI assistant things like:

- "Show me upcoming Premier League matches"
- "Get ML and totals odds for the next Arsenal match from Bet365 and SingBet"
- "Where is the best price on the Lakers game, and what is the fair price?"
- "Find value bets on Bet365 in baseball"
- "Are there arbitrage opportunities over 1% between Bet365 and Unibet in football?"
- "Show me how the spread moved for event 12345"
- "Give me Premier League closing lines for last season from Bet365"
- "Did these three bets win?"
- "Who is favourite to win the next PGA Tour event, and what are the Top 10 prices?"
- "How many requests do I have left this hour?"

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
