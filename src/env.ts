// Minimal .env loader (no dotenv dependency). Reads ./.env if present and
// populates process.env for any key not already set. Import this FIRST in each
// entrypoint, before importing ./server.js, so the server's env validation sees
// the values. In production (Render/Railway/Fly/Vercel/VPS) env vars are set by
// the host and no .env file exists — this loader is a no-op there.
import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
        const m = raw.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (!m) continue;
        const key = m[1];
        if (key in process.env) continue; // real env wins over .env
        let val = (m[2] ?? "").trim();
        if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
        ) {
            val = val.slice(1, -1);
        }
        process.env[key] = val;
    }
}
