# research-library MCP server

MCP server over Close Readings + Academic Library + drafts (Supabase + OpenAI
embeddings). Runs two ways from one shared tool definition:

- **stdio** — for Claude Desktop (unchanged behaviour).
- **Streamable HTTP** — a remote `/mcp` endpoint for ChatGPT custom MCP connectors.

## Layout

- `src/server.ts` — `createServer()` factory: builds the MCP server and registers
  all 37 tools. Transport-agnostic, no secrets, no startup code.
- `src/stdio.ts` — Claude Desktop entrypoint (`StdioServerTransport`).
- `src/http.ts` — remote entrypoint: Express + `StreamableHTTPServerTransport`,
  `POST /mcp`, `GET /health`, optional bearer auth.
- `src/env.ts` — loads `./.env` as a fallback when env vars aren't set by the host.

## Environment

Copy `.env.example` to `.env` and fill in:

| var | required | purpose |
|-----|----------|---------|
| `SUPABASE_URL` | yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | service-role key (server-side only) |
| `OPENAI_API_KEY` | for semantic/embedding tools | query embeddings |
| `PORT` | no (default 3000) | HTTP port |
| `MCP_BEARER_TOKEN` | no | if set, `/mcp` requires `Authorization: Bearer <token>` |

The server fails fast if `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are missing.
The OpenAI client is created lazily, so the server starts without a key — only
the embedding/semantic-search tools error if it's absent.

## Build

```
npm install
npm run build
```

## Running with Claude Desktop

Use the stdio entrypoint. Point the Claude config at the built file and supply env
in the config's `env` block (or the shell):

```json
{
  "mcpServers": {
    "research-library": {
      "command": "node",
      "args": ["/absolute/path/to/MCPS/research-library/dist/stdio.js"],
      "env": {
        "SUPABASE_URL": "https://YOUR.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "…",
        "OPENAI_API_KEY": "sk-…"
      }
    }
  }
}
```

Equivalent to the original `node dist/index.js`; tool names, schemas, and behaviour
are unchanged. (The original `research-library-mcp-server` repo is untouched and
still serves Claude today; this is a separate copy.)

## Running as Remote MCP for ChatGPT

```
npm run build
npm run start:http
```

Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, and (recommended
before public exposure) `MCP_BEARER_TOKEN`. Expose the app over HTTPS, then use the
endpoint — e.g. `https://your-domain.example/mcp` — in the ChatGPT MCP connector
setup. Health check: `GET https://your-domain.example/health`.

Quick local check:

```
curl localhost:3000/health
curl -X POST localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

## Deployment notes

The HTTP server is stateless (a fresh server + transport per request,
`sessionIdGenerator: undefined`), so it deploys cleanly to any HTTPS host:

- **Render / Railway / Fly.io** — Node service, build `npm install && npm run build`,
  start `npm run start:http`, set the env vars in the dashboard, set `MCP_BEARER_TOKEN`.
- **VPS** — `npm ci && npm run build && PORT=3000 npm run start:http` behind nginx/caddy
  with TLS terminating to the port.
- **Vercel** — works but serverless functions suit the stateless transport only;
  a long-lived Node service (Render/Railway/Fly) is simpler.

Auth: the bearer gate is a prototype. The production path for ChatGPT connectors is
OAuth 2.1 + PKCE (TODO in `src/http.ts`).

Never commit `.env`; it is gitignored. `.env.example` holds placeholders only.
