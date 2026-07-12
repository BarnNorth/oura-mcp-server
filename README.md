# oura-mcp-server

A personal MCP (Model Context Protocol) server that exposes your own Oura Ring
data — sleep, readiness, activity, heart rate, workouts, tags — as tools
Claude Desktop or Claude Code can call directly.

**Important scope note:** this only works with **Claude Desktop** or
**Claude Code**, which can launch local MCP servers as subprocesses. It does
**not** work with claude.ai in a browser or the mobile app — those can only
use hosted (remote) connectors, and there is no first-party hosted Oura
connector from Anthropic as of this writing.

**Also important:** Oura deprecated Personal Access Tokens in December 2025.
The old "generate a token in your account settings and paste it into a
script" shortcut you may see in older blog posts no longer works. This
server uses the full OAuth2 flow, which is now mandatory even for pulling
just your own data.

---

## Using this if you didn't write it

This repo is a template, not a shared service — there's no account or data
tied to it. If you're setting this up for yourself:

- **Register your own OAuth application** in step 1 below. Don't reuse
  someone else's Client ID/Secret — each person needs their own app
  registration, since Oura ties API access to the app that requests it.
- **Everything stays local to your machine.** Your `.env` (Client
  ID/Secret) and `~/.oura-mcp/tokens.json` (access/refresh tokens) are
  created fresh when you run through the setup steps, are gitignored, and
  are never read from or written to this repo. Cloning this code gives you
  the *program*, not anyone's credentials or health data.
- **You authorize your own Oura account** in step 3 — the OAuth login
  screen is Oura's, not this project's, so you're logging into (and
  granting access to) your own account only.
- Per [Oura's API agreement](https://cloud.ouraring.com/legal/api-agreement),
  personal use to access your own data is fine, but the data can't be
  cached/stored beyond what's needed to serve a request, shared with third
  parties, or used to train/fine-tune an AI model. This server already
  follows that: it fetches data live on each tool call and never writes API
  responses to disk (only OAuth tokens are persisted, which is required for
  auth).

---

## What this gives you

10 MCP tools:

| Tool | What it returns |
|---|---|
| `oura_get_daily_sleep` | Daily sleep score + contributors (REM, deep, efficiency, restfulness) |
| `oura_get_daily_readiness` | Daily readiness score + contributors (HRV balance, resting HR, recovery index) |
| `oura_get_daily_activity` | Daily activity score, steps, active calories |
| `oura_get_daily_spo2` | Nightly average blood oxygen saturation |
| `oura_get_sleep_periods` | Raw per-sleep-period data: actual HRV average, lowest/avg HR during sleep, stage durations, bedtime start/end |
| `oura_get_heartrate` | Raw 5-minute-resolution heart rate time series between two datetimes |
| `oura_get_workouts` | Logged/auto-detected workouts: type, duration, calories, intensity |
| `oura_get_tags` | User-entered tags/notes (e.g. "alcohol", "illness") |
| `oura_get_personal_info` | Age, weight, height, biological sex on file with Oura |
| `oura_call_endpoint` | Escape hatch for any other `usercollection/*` endpoint (e.g. `usercollection/rest_mode_period`, `usercollection/ring_configuration`) not covered above |

The escape-hatch tool and every other tool are hard-restricted to read-only
`usercollection/*` paths — the server refuses to call `webhook/*`
(subscription management) or anything else, so there's no path for this to
accidentally do anything beyond reading your own data.

Tokens auto-refresh. You authorize once; after that, `npm start` just works
until you manually revoke access on Oura's side.

---

## 1. Register an Oura OAuth application (one-time, ~2 minutes)

1. Go to <https://cloud.ouraring.com/oauth/applications> and sign in with
   your Oura account.
2. Create a new application. Name/website can be anything descriptive
   ("Personal MCP server" is fine).
3. Set the **redirect URI** to exactly:
   ```
   http://localhost:8734/callback
   ```
   (If you want a different port, change `OURA_AUTH_PORT` in `.env` and
   update the redirect URI here to match — they must be identical.)
4. Copy the **Client ID** and **Client Secret** it gives you.

## 2. Install and configure

```bash
git clone https://github.com/BarnNorth/oura-mcp-server.git
cd oura-mcp-server
npm install
cp .env.example .env
```

Edit `.env` and paste in your Client ID and Client Secret:

```
OURA_CLIENT_ID=your_client_id_here
OURA_CLIENT_SECRET=your_client_secret_here
```

## 3. Run the one-time authorization

```bash
npm run authorize
```

This prints a URL — open it in your browser, log into Oura, and approve the
requested scopes. The script catches the redirect automatically, exchanges
the code for tokens, and saves them to `~/.oura-mcp/tokens.json` (permissions
locked to your user only, `chmod 600`). You only need to do this once; after
that the server refreshes tokens on its own.

If you ever see an error about a revoked or invalid refresh token, just
re-run `npm run authorize`.

## 4. Point Claude Desktop at the server

Open (or create) Claude Desktop's config file:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux:** `~/.config/Claude/claude_desktop_config.json`

Add an entry under `mcpServers` (merge with whatever's already there — don't
replace the whole file if you have other servers configured):

```json
{
  "mcpServers": {
    "oura": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/oura-mcp-server/.env",
        "/absolute/path/to/oura-mcp-server/src/server.js"
      ]
    }
  }
}
```

Use **absolute paths** on your machine — relative paths won't resolve
correctly since Claude Desktop launches it as a subprocess from its own
working directory. The `--env-file` flag is required here: unlike `npm run
start`, Claude Desktop invokes `node` directly, so nothing else loads `.env`
into the process.

Fully quit and reopen Claude Desktop (not just close the window — Cmd+Q on
macOS, or quit from the system tray on Windows). Start a new conversation;
you should see a tools/hammer icon indicating the server connected, and you
can ask things like "pull my Oura readiness for the last 7 days."

For **Claude Code**, the equivalent is a project-level `.mcp.json`:

```json
{
  "mcpServers": {
    "oura": {
      "type": "stdio",
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/oura-mcp-server/.env",
        "/absolute/path/to/oura-mcp-server/src/server.js"
      ]
    }
  }
}
```

---

## Security notes (read this once)

- Your Client Secret and tokens never leave your machine — everything runs
  as a local subprocess talking directly to `api.ouraring.com`. There's no
  third party in the middle.
- `.env` and `~/.oura-mcp/tokens.json` are both in `.gitignore`. If you ever
  put this project in a git repo (recommended, since it's your own code),
  double check those never get committed.
- The server only requests read scopes and only calls `usercollection/*`
  read endpoints — it cannot modify your Oura data, delete anything, or
  manage webhook subscriptions on your account.
- Rate limit is 5,000 requests / 5 minutes per Oura's v2 API — you will not
  come close to this with normal conversational use.

## Troubleshooting

- **"No stored Oura tokens found"** — run `npm run authorize` before
  `npm start`.
- **401 after refresh** — the refresh token was revoked (e.g. you removed
  the app's access in your Oura account settings). Re-run
  `npm run authorize`.
- **403 Forbidden** — either the granted scope doesn't cover that endpoint,
  or your Oura membership has lapsed (Oura requires an active membership for
  API access on Gen3+ rings).
- **Claude Desktop doesn't show the tools** — check the exact JSON syntax
  (a stray comma breaks the whole config file silently), confirm the path in
  `args` is absolute, and check Claude's MCP logs (macOS:
  `~/Library/Logs/Claude/`).
