# Changelog

## 1.8.4 (2026-11-13)

- Docs: the `markets` parameter description and the README link to the market reference at https://odds-api.io/markets; the README links bookmaker coverage at https://odds-api.io/sportsbooks#coverage.

## 1.8.3

First release published from GitHub Actions with npm/PyPI trusted publishing and provenance. No code changes.

## 1.8.2 (2026-11-06)

### Fixed
- `get_value_bets` described `expectedValue` as `(probability x odds) - 1`. It is bookmaker/fair x 100; edge % = `expectedValue - 100` (103.42 is a 3.42% edge). The tool description, the odds-api skill and the README now say so.
- `get_arbitrage_bets` now states that `profitMargin` is already a percentage (2.48 means 2.48%).

## 1.8.1

Republish of 1.8.0 (same code). 1.8.0 was staged on npm and not published.

## 1.8.0 (2026-11-06)

Covers every public Odds-API.io v3 REST endpoint (33 tools, up from 25).

### Added
- `get_odds_summary`: best, average, median, worst and fair price per line across bookmakers, for one event or up to 10.
- `get_closing_lines`: closing odds for every settled event across up to 10 leagues and 366 days.
- `search_historical_events`: finished events by team name.
- `list_outrights`, `get_outright_odds`, `get_outright_results`: golf outrights (Winner, Top 5/10/20, Top N (Incl. Ties), Make Cut). `get_outright_odds` takes `markets` and `maxRunners` filters. A 403 from a key without the Outrights add-on is passed through with the API's message.
- `get_mappings`: bookmaker event, market and outcome ids (Polymarket, Kalshi), lookup or cursor-paged bulk sync.
- `get_usage`: hourly request limit, remaining requests and reset time from the API's rate-limit headers.
- `markets` on `get_odds`, `get_multi_odds` and `get_historical_odds`.
- `status` (upcoming or live) on `search_events`; `sport` and `league` on `get_value_bets`; `sport`, `league`, `markets`, `minProfit` and `allCombinations` on `get_arbitrage_bets`; `limit` on `get_updated_odds`.
- `fields` and `maxResults` on list tools to trim large responses.
- Tool titles and annotations: `readOnlyHint` on every read tool, `destructiveHint` on `clear_selected_bookmakers`, `idempotentHint` on both selection tools.
- Server `instructions`, an agent guide at `skills/odds-api/SKILL.md` (also the `odds-api://guide` resource) and three prompts: `compare_odds`, `settle_bets`, `golf_outrights`.

### Changed
- Default base URL is `https://api.odds-api.io/v3`.
- Tool descriptions say which tool to call first, which plan or add-on a tool needs and what it returns.
- Responses are compact JSON.
- Errors keep the API's message and add guidance: 403 and 429 tell the agent not to retry, 429 includes the reset time.
- The API key is masked in every output and error.
- `get_markets` no longer requires `sport` (omit it for every sport).
- `get_updated_odds` allows up to 40 markets; `get_events` lists the `cancelled` status; `get_bookmakers` documents `status` and `reason`.
- `grade_bets` selections no longer require `side`, so labelled markets (correct score, exact goals) can be graded.
- Score descriptions use the period keys `p1..pN`, `ft`, `ot`, `ap`; the older `period1`, `overtime`, `penalties` and `fulltime` keys stop on 12 November 2026.
