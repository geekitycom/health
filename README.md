# health

A personal tracker for a keto and weight-loss journey. Log daily weight, periodic readings (glucose, ketones, blood pressure), and food with macros in a small web app. An LLM coach reads the same data through a built-in MCP server.

## Run

```sh
pnpm install
cp .env.example .env
pnpm dev
```

Open http://localhost:3000. The data lives in one SQLite file (`data/health.db` by default), using Node's built-in `node:sqlite`.

## Configuration

| Variable        | Default              | Purpose                                                                         |
| --------------- | -------------------- | ------------------------------------------------------------------------------- |
| `PORT`          | `3000`               | HTTP port.                                                                      |
| `PUBLIC_URL`    | from request headers | Public origin used in OAuth metadata, for example `https://health.example.com`. |
| `DATABASE_PATH` | `data/health.db`     | SQLite file. The Docker image uses `/data/health.db`.                           |
| `TIME_ZONE`     | system zone          | IANA zone that decides what "today" is, for example `America/Chicago`.          |
| `WEIGHT_UNIT`   | `lb`                 | `lb` or `kg`. Weights are stored as entered.                                    |
| `APP_PASSWORD`  | unset (open)         | Protects the web UI with a sign-in form and a 90-day session cookie.            |
| `MCP_TOKEN`     | unset (open)         | Static bearer token that `/mcp` accepts alongside OAuth tokens.                 |

Set both `APP_PASSWORD` and `MCP_TOKEN` on any server reachable from the internet.

## What gets tracked

- **Weight.** One entry per day. Saving again for the same day replaces it.
- **Readings.** Each reading is one type, picked from a dropdown: glucose (mg/dL), ketones (mmol/L), or blood pressure (systolic and diastolic). A ketone reading gets a glucose-ketone index (GKI) when a glucose reading was taken within 30 minutes of it on the same day.
- **Food.** A timestamped item with a meal, a description, and optional calories, fat, protein, carbs, and fiber in grams. Net carbs are carbs minus fiber.

Dates and times are stored as the local wall-clock values you enter.

## MCP server

`/mcp` serves the MCP Streamable HTTP transport in stateless mode. The tools are read-only:

| Tool           | Returns                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| `get_summary`  | Weight trend, reading averages (glucose, ketones, GKI, BP), average daily macros. |
| `get_weights`  | Daily weigh-ins.                                                                  |
| `get_readings` | Every reading by type; ketone readings include their GKI.                         |
| `get_food_log` | Every food item with net carbs, plus per-day totals.                              |

Each tool takes optional `from` and `to` (`YYYY-MM-DD`) or `days` (1 to 366). The default is the last 30 days ending today.

### Connecting

When `APP_PASSWORD` or `MCP_TOKEN` is set, `/mcp` requires a bearer token. There are two ways to get one.

**OAuth (claude.ai, Claude Desktop, and other remote connectors).** Add `https://health.example.com/mcp` as a custom connector and leave the OAuth client fields empty. The client registers itself, sends you to the app's sign-in page, and asks you to allow read access. Access tokens last a day and refresh automatically; refresh tokens last a year.

**Static token (Claude Code and other clients that send headers).**

```sh
claude mcp add --transport http health https://health.example.com/mcp \
  --header "Authorization: Bearer $MCP_TOKEN"
```

## Docker

```sh
docker run -d -p 3000:3000 -v health-data:/data \
  -e TIME_ZONE=America/Chicago -e APP_PASSWORD=... -e MCP_TOKEN=... \
  ghcr.io/geekitycom/health:latest
```

Releases follow release-please. Merging the release PR on `main` publishes a multi-arch image to GHCR.

## Development

```sh
pnpm test        # vitest
pnpm typecheck
pnpm lint
pnpm format:check
```
