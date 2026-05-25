// Claude Desktop entrypoint — preserves the original stdio behaviour.
// Build: npm run build → dist/stdio.js. Run: node dist/stdio.js
// Env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY) comes from the
// Claude config's `env` block or the shell; ./.env is loaded as a fallback.
import "./env.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("research-library MCP server running on stdio");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
