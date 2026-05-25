// Remote MCP entrypoint for ChatGPT (and any HTTP MCP client).
// Build: npm run build → dist/http.js. Run: npm run start:http
// Exposes POST /mcp (Streamable HTTP transport) and GET /health.
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY, PORT,
//      MCP_BEARER_TOKEN (optional prototype auth).
import "./env.js";
import express from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const PORT = Number(process.env.PORT) || 3000;
const BEARER = process.env.MCP_BEARER_TOKEN;
const READ_ONLY = process.env.MCP_READONLY === "1" || process.env.MCP_READONLY === "true";

const app = express();
app.use(express.json({ limit: "8mb" }));

// Health check — never gated.
app.get("/health", (_req: any, res: any) => {
    res.json({ status: "ok", server: "research-library", transport: "streamable-http" });
});

// Prototype bearer-token gate for /mcp. If MCP_BEARER_TOKEN is unset, requests
// pass (dev mode) and a warning prints at startup.
// TODO: OAuth 2.1 + PKCE is the long-term production auth path for ChatGPT.
function requireAuth(req: any, res: any, next: any) {
    if (!BEARER) return next();
    if (req.headers.authorization === `Bearer ${BEARER}`) return next();
    res.status(401).json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null });
}

// Stateless Streamable HTTP: a fresh server + transport per POST, so no transport
// is ever shared across requests and the endpoint scales horizontally.
app.post("/mcp", requireAuth, async (req: any, res: any) => {
    const server = createServer({ readOnly: READ_ONLY });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => { transport.close(); server.close(); });
    try {
        await server.connect(transport);
        await transport.handleRequest(req, res, req.body);
    } catch (err) {
        console.error("MCP request error:", err);
        if (!res.headersSent) {
            res.status(500).json({ jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
        }
    }
});

// Stateless mode supports neither server-initiated SSE streams nor session deletion.
const methodNotAllowed = (_req: any, res: any) =>
    res.status(405).json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
app.get("/mcp", methodNotAllowed);
app.delete("/mcp", methodNotAllowed);

app.listen(PORT, () => {
    console.error(`research-library MCP (streamable-http) listening on :${PORT}  ·  POST /mcp  ·  GET /health  ·  toolset=${READ_ONLY ? "READ-ONLY (29)" : "full (37)"}`);
    if (!BEARER) {
        console.error("WARNING: MCP_BEARER_TOKEN not set — /mcp is UNAUTHENTICATED. Set it before exposing this server publicly.");
    }
});
