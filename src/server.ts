import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import OpenAI from "openai";
// Supabase configuration
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing required Supabase environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
// OpenAI embedding API (text-embedding-3-small, 1536 dims)
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
    if (!_openai) {
        if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is required for embedding / semantic-search tools");
        _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }
    return _openai;
}
async function getQueryEmbedding(text) {
    const res = await getOpenAI().embeddings.create({
        model: "text-embedding-3-small",
        input: text,
    });
    return res.data[0].embedding;
}
// Robust error stringifier. Supabase/Postgres errors are plain objects whose
// default _errStr(err) returns "[object Object]". This pulls message + code +
// details + hint when present, falls back to JSON.stringify, then to
// Object.prototype.toString. Use everywhere instead of _errStr(err).
function _errStr(err: any): string {
    if (err == null) return "unknown error";
    if (typeof err === "string") return err;
    if (err instanceof Error) return err.message || err.toString();
    if (typeof err === "object") {
        if (typeof err.message === "string") {
            const parts: string[] = [String(err.message)];
            if (err.code) parts.push(`(${String(err.code)})`);
            if (err.details) parts.push(`details: ${String(err.details)}`);
            if (err.hint) parts.push(`hint: ${String(err.hint)}`);
            return parts.join(" ");
        }
        try { return JSON.stringify(err); } catch { return Object.prototype.toString.call(err); }
    }
    return _errStr(err);
}
export function createServer(opts: { readOnly?: boolean } = {}) {
const server = new McpServer({
    name: "research-library",
    version: "1.0.0",
    description: `IMPORTANT: Before using any tools, read the skill file at "/Users/justin/Folders for Claude Coworker/skills/research-library/SKILL.md".

How to handle tool results:
- The *_get_text and *_get_content tools (library_get_text, literary_get_text, drafts_get_content, readings_get_content) now return TWO plain text blocks: a small markdown metadata header, followed by the actual source text. Read the source text directly. Do NOT echo it back to the user as JSON or as a code block — quote from it as you would from any reading.
- The *_search, *_browse, *_list, and *_get_annotations tools return JSON arrays/objects with metadata and scores. Parse them to pick relevant rows; do not display the raw JSON to the user — summarize or quote the parts that matter.
- On error, the tool returns a single JSON object with an "error" field. Surface the error briefly to the user and choose another tool / argument.

The skill file has the full catalog of file_name values needed for library_get_text.`,
});
// Read-only gating (opt-in via http.ts when MCP_READONLY is set).
if (opts.readOnly) {
    const allow = new Set([
        "library_search", "library_semantic_search", "library_browse_category", "library_by_author",
        "library_by_subject", "library_list_categories", "library_get_text", "library_find_quote",
        "literary_search", "literary_semantic_search", "literary_browse", "literary_get_text",
        "drafts_search", "drafts_semantic_search", "drafts_get_content", "drafts_list_project", "drafts_list_projects",
        "bibliography_list", "bibliography_get_content", "bibliography_search",
        "readings_list_all", "readings_get_content", "readings_get_related", "readings_search_author",
        "readings_search_concept", "readings_search_theme", "readings_search_content", "readings_semantic_search",
        "readings_list_themes_concepts",
        "journal_list_models", "journal_project_draft", "journal_dependency_map", "journal_revision_plan",
    ]);
    const origTool = server.tool.bind(server);
    (server as any).tool = (name: string, ...rest: any[]) => allow.has(name) ? (origTool as any)(name, ...rest) : undefined;
}
// Tool 1: Search readings by theme
server.tool("readings_search_theme", "Search close readings by theme (e.g., dissociation, imagination, sensibility, synthesis, cognition, metaphysics, expression, poetics, aesthetics, perception, intuition, understanding, feeling, thought, sound, vision, unity, form, meaning, language)", {
    theme: z.string().describe("Theme to search for"),
}, async ({ theme }) => {
    try {
        const { data, error } = await supabase
            .from("close_readings")
            .select("file_name, source_author, source_title, category, themes, summary")
            .contains("themes", [theme.toLowerCase()]);
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        readings: data?.map(r => ({
                            file_name: r.file_name,
                            author: r.source_author,
                            title: r.source_title,
                            category: r.category,
                            themes: r.themes,
                            summary: r.summary?.slice(0, 300)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 2: Search readings by concept
server.tool("readings_search_concept", "Search close readings by concept (e.g., objective_correlative, unified_sensibility, transcendental_aesthetic, schematism, aesthetic_ideas, free_play, grammatical_parallelism, poetic_function, hypertrophy, denotation_connotation, double_sanction, word_made_flesh)", {
    concept: z.string().describe("Concept to search for"),
}, async ({ concept }) => {
    try {
        const { data, error } = await supabase
            .from("close_readings")
            .select("file_name, source_author, source_title, category, concepts, summary")
            .contains("concepts", [concept.toLowerCase()]);
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        readings: data?.map(r => ({
                            file_name: r.file_name,
                            author: r.source_author,
                            title: r.source_title,
                            category: r.category,
                            concepts: r.concepts,
                            summary: r.summary?.slice(0, 300)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 3: Search readings by author
server.tool("readings_search_author", "Search close readings by source author (e.g., Eliot, Kant, Jakobson, Richards, Barfield)", {
    author: z.string().describe("Author name to search for"),
}, async ({ author }) => {
    try {
        const { data, error } = await supabase
            .from("close_readings")
            .select("file_name, source_author, source_title, category, reading_type, themes, summary")
            .ilike("source_author", `%${author}%`);
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        readings: data?.map(r => ({
                            file_name: r.file_name,
                            author: r.source_author,
                            title: r.source_title,
                            category: r.category,
                            type: r.reading_type,
                            themes: r.themes,
                            summary: r.summary?.slice(0, 300)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 4: Full-text search across content
server.tool("readings_search_content", "Full-text search across all close reading content", {
    query: z.string().describe("Search query (e.g., 'dissociation sensibility' or 'imagination unified')"),
}, async ({ query }) => {
    try {
        const { data, error } = await supabase.rpc("search_content", { search_query: query });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        readings: data?.slice(0, 20).map((r) => ({
                            file_name: r.file_name,
                            author: r.source_author,
                            title: r.source_title,
                            relevance: r.rank,
                            summary: r.summary?.slice(0, 300)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 5: Get related readings
server.tool("readings_get_related", "Get readings related to a specific close reading", {
    file_name: z.string().describe("File name of the reading (e.g., ELIOT_METAPHYSICAL_POETS_01.md)"),
}, async ({ file_name }) => {
    try {
        // First get the reading ID
        const { data: reading, error: readingError } = await supabase
            .from("close_readings")
            .select("id, file_name, source_author")
            .eq("file_name", file_name)
            .single();
        if (readingError || !reading) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Reading not found" }) }] };
        }
        // Get related readings
        const { data, error } = await supabase.rpc("get_related_readings", { reading_id: reading.id });
        if (error)
            throw error;
        // Group by relation type
        const byType: Record<string, any[]> = {};
        (data || [] as any[]).forEach((r: any) => {
            if (!byType[r.relation_type])
                byType[r.relation_type] = [];
            byType[r.relation_type].push(r);
        });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        source: { file_name: reading.file_name, author: reading.source_author },
                        total_relations: data?.length || 0,
                        by_type: Object.fromEntries(Object.entries(byType).map(([type, readings]) => [
                            type,
                            readings.slice(0, 10).map(r => ({
                                file_name: r.file_name,
                                author: r.source_author,
                                strength: r.strength,
                                shared_themes: r.shared_themes
                            }))
                        ]))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 6: Get full content of a reading
server.tool("readings_get_content", "Get the full content of a specific close reading", {
    file_name: z.string().describe("File name of the reading to retrieve"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("close_readings")
            .select("*")
            .eq("file_name", file_name)
            .single();
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        metadata: {
                            file_name: data.file_name,
                            author: data.source_author,
                            title: data.source_title,
                            year: data.source_year,
                            category: data.category,
                            type: data.reading_type,
                            themes: data.themes,
                            concepts: data.concepts,
                            related_authors: data.related_authors
                        },
                        content: data.content
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 7: List all readings (index)
server.tool("readings_list_all", "List all close readings in the database with metadata (no content)", {
    category: z.string().optional().describe("Optional: filter by category (e.g., '3_Dissociation', '2_Kant')"),
}, async ({ category }) => {
    try {
        let query = supabase
            .from("close_readings")
            .select("file_name, source_author, source_title, category, reading_type, themes")
            .order("category")
            .order("source_author");
        if (category) {
            query = query.eq("category", category);
        }
        const { data, error } = await query;
        if (error)
            throw error;
        // Group by category
        const byCategory: Record<string, any[]> = {};
        (data || []).forEach(r => {
            if (!byCategory[r.category])
                byCategory[r.category] = [];
            byCategory[r.category].push(r);
        });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        total: data?.length || 0,
                        by_category: Object.fromEntries(Object.entries(byCategory).map(([cat, readings]) => [
                            cat,
                            readings.map(r => ({
                                file_name: r.file_name,
                                author: r.source_author,
                                title: r.source_title,
                                type: r.reading_type,
                                themes: r.themes
                            }))
                        ]))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 8: List available themes and concepts
server.tool("readings_list_themes_concepts", "List all available themes and concepts with their counts", {}, async () => {
    try {
        const { data, error } = await supabase
            .from("close_readings")
            .select("themes, concepts");
        if (error)
            throw error;
        const themeCounts: Record<string, number> = {};
        const conceptCounts: Record<string, number> = {};
        (data || []).forEach(r => {
            (r.themes || []).forEach((t) => {
                themeCounts[t] = (themeCounts[t] || 0) + 1;
            });
            (r.concepts || []).forEach((c) => {
                conceptCounts[c] = (conceptCounts[c] || 0) + 1;
            });
        });
        const sortedThemes = Object.entries(themeCounts).sort((a, b) => b[1] - a[1]);
        const sortedConcepts = Object.entries(conceptCounts).sort((a, b) => b[1] - a[1]);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        themes: Object.fromEntries(sortedThemes),
                        concepts: Object.fromEntries(sortedConcepts)
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// LIBRARY TOOLS (Academic Library Database)
// Split across 3 tables: journal_articles, books, book_chapters
// ================================================
const LIBRARY_TABLES = ["journal_articles", "books", "edited_volumes", "book_chapters"];
function getTextType(table) {
    switch (table) {
        case "journal_articles": return "article";
        case "books": return "book";
        case "edited_volumes": return "edited_volume";
        case "book_chapters": return "chapter";
    }
}
function getTypeSpecificMeta(table, row) {
    switch (table) {
        case "journal_articles":
            return { journal: row.journal, volume: row.volume, issue: row.issue, pages: row.pages };
        case "books":
            return { publisher: row.publisher, editors: row.editors };
        case "edited_volumes":
            return { publisher: row.publisher, editors: row.editors };
        case "book_chapters":
            return { book_title: row.book_title, editors: row.editors, publisher: row.publisher, pages: row.pages };
    }
}
// Tool 9: Search library full-text
server.tool("library_search", "Full-text search across all academic library texts (journal articles, books, book chapters). Returns ranked results by relevance.", {
    query: z.string().describe("Search query (e.g., 'embodied cognition' or 'dissociation of sensibility')"),
    category: z.string().optional().describe("Optional: limit to category (Cognitive, Eliot, Philosophy, etc.)"),
    max_results: z.number().optional().describe("Max results (default 30)"),
}, async ({ query, category, max_results = 30 }) => {
    try {
        const allResults: any[] = [];
        for (const table of LIBRARY_TABLES) {
            let q = supabase
                .from(table)
                .select("file_name, author, title, year, category, subcategory, word_count" +
                (table === "journal_articles" ? ", journal, volume, issue, pages" : "") +
                (table === "books" || table === "edited_volumes" ? ", publisher, editors" : "") +
                (table === "book_chapters" ? ", book_title, editors, publisher, pages" : ""))
                .textSearch("content", query, { type: "websearch" })
                .limit(max_results);
            if (category)
                q = q.eq("category", category);
            const { data, error } = await q;
            if (error)
                throw error;
            (data || [] as any[]).forEach((r: any) => {
                allResults.push({
                    file_name: r.file_name,
                    author: r.author,
                    title: r.title,
                    year: r.year,
                    category: r.category,
                    subcategory: r.subcategory,
                    word_count: r.word_count,
                    _type: getTextType(table),
                    ...getTypeSpecificMeta(table, r),
                });
            });
        }
        // Score by title-match relevance: terms appearing in the title get +10 each.
        // Prefer shorter (more focused) texts as a tiebreaker.
        // Better than word_count DESC; a true ts_rank would require a custom RPC.
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        function relevance(item) {
            const title = (item.title || "").toLowerCase();
            let score = 0;
            for (const term of queryTerms) {
                if (title.includes(term))
                    score += 10;
            }
            score -= Math.log((item.word_count || 100000)) * 0.1;
            return score;
        }
        allResults.sort((a, b) => relevance(b) - relevance(a));
        const limited = allResults.slice(0, max_results);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: limited.length,
                        results: limited
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 10: Browse library by author
server.tool("library_by_author", "Find all texts by a specific author in the academic library (journal articles, books, book chapters)", {
    author: z.string().describe("Author name to search for"),
}, async ({ author }) => {
    try {
        const allResults: any[] = [];
        for (const table of LIBRARY_TABLES) {
            const { data, error } = await supabase
                .from(table)
                .select("file_name, author, title, year, category, subcategory, word_count" +
                (table === "journal_articles" ? ", journal, volume, issue, pages" : "") +
                (table === "books" || table === "edited_volumes" ? ", publisher, editors" : "") +
                (table === "book_chapters" ? ", book_title, editors, publisher, pages" : ""))
                .ilike("author", `%${author}%`)
                .order("year", { ascending: true });
            if (error)
                throw error;
            (data || [] as any[]).forEach((r: any) => {
                allResults.push({
                    file_name: r.file_name,
                    author: r.author,
                    title: r.title,
                    year: r.year,
                    category: r.category,
                    subcategory: r.subcategory,
                    word_count: r.word_count,
                    _type: getTextType(table),
                    ...getTypeSpecificMeta(table, r),
                });
            });
        }
        allResults.sort((a, b) => (a.year || 0) - (b.year || 0));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: allResults.length,
                        texts: allResults
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 11: Browse library by category
server.tool("library_browse_category", "Browse texts in a specific category of the academic library (journal articles, books, book chapters)", {
    category: z.string().describe("Category (Cognitive, Eliot, Philosophy, Early_Modern, Medieval, Milton, Modernism, Poetics, Semiotics, Theory_Method, Disability_Studies)"),
    subcategory: z.string().optional().describe("Optional subcategory"),
}, async ({ category, subcategory }) => {
    try {
        const allResults: any[] = [];
        for (const table of LIBRARY_TABLES) {
            let q = supabase
                .from(table)
                .select("file_name, author, title, year, subcategory, word_count" +
                (table === "journal_articles" ? ", journal, volume, issue, pages" : "") +
                (table === "books" || table === "edited_volumes" ? ", publisher, editors" : "") +
                (table === "book_chapters" ? ", book_title, editors, publisher, pages" : ""))
                .eq("category", category)
                .order("author");
            if (subcategory) {
                q = q.eq("subcategory", subcategory);
            }
            const { data, error } = await q;
            if (error)
                throw error;
            (data || [] as any[]).forEach((r: any) => {
                allResults.push({
                    file_name: r.file_name,
                    author: r.author,
                    title: r.title,
                    year: r.year,
                    subcategory: r.subcategory,
                    word_count: r.word_count,
                    _type: getTextType(table),
                    ...getTypeSpecificMeta(table, r),
                });
            });
        }
        allResults.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        category,
                        count: allResults.length,
                        texts: allResults
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 12: Get full text content
server.tool("library_get_text", "Get the full content of a text from the academic library (journal articles, books, book chapters) or literary texts collection. Returns the source text as plain text blocks (markdown metadata header + body). Read the body to answer; do not display it back as JSON.", {
    file_name: z.string().describe("File name of the text"),
}, async ({ file_name }) => {
    try {
        let data: any = null;
        let foundTable: string | null = null;
        // Check all 3 library tables, then literary_texts as fallback
        for (const table of [...LIBRARY_TABLES, "literary_texts"]) {
            const result = await supabase
                .from(table)
                .select("*")
                .eq("file_name", file_name)
                .single();
            if (result.data) {
                data = result.data;
                foundTable = table;
                break;
            }
        }
        if (!data) {
            return { content: [{ type: "text", text: JSON.stringify({ error: "Text not found in any table" }) }] };
        }
        const metadata: any = {
            file_name: data.file_name,
            author: data.author,
            title: data.title,
            year: data.year,
            category: data.category,
            subcategory: data.subcategory,
            word_count: data.word_count,
        };
        if (foundTable && foundTable !== "literary_texts" && LIBRARY_TABLES.includes(foundTable)) {
            metadata._type = getTextType(foundTable);
            Object.assign(metadata, getTypeSpecificMeta(foundTable, data));
        }
        // Return the metadata header and the actual content as separate
        // text blocks — NOT wrapped in JSON. Wrapping the content in a JSON
        // string was making downstream LLMs (Claude in the desktop chat)
        // mis-treat the tool result as a structured payload to display
        // rather than as a body of source text to read. The metadata block
        // is a short markdown header so it's still parseable when needed.
        const metaHeader = [
            `# ${metadata.title || metadata.file_name}`,
            metadata.author ? `**Author:** ${metadata.author}` : null,
            metadata.year ? `**Year:** ${metadata.year}` : null,
            metadata._type ? `**Type:** ${metadata._type}` : null,
            metadata.journal ? `**Journal:** ${metadata.journal}` : null,
            metadata.book_title ? `**Book:** ${metadata.book_title}` : null,
            metadata.publisher ? `**Publisher:** ${metadata.publisher}` : null,
            metadata.pages ? `**Pages:** ${metadata.pages}` : null,
            metadata.category ? `**Category:** ${metadata.category}${metadata.subcategory ? ` / ${metadata.subcategory}` : ''}` : null,
            metadata.word_count ? `**Word count:** ${metadata.word_count}` : null,
            `**file_name:** \`${metadata.file_name}\``,
        ].filter(Boolean).join('\n');
        return {
            content: [
                { type: "text", text: metaHeader },
                { type: "text", text: data.content || "(no content stored)" },
            ],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 13: List library categories
server.tool("library_list_categories", "List all categories in the academic library with text counts (across journal articles, books, and book chapters)", {}, async () => {
    try {
        const categoryCounts: Record<string, any> = {};
        for (const table of LIBRARY_TABLES) {
            const { data, error } = await supabase
                .from(table)
                .select("category, subcategory");
            if (error)
                throw error;
            const typeKey = table === "journal_articles" ? "articles" :
                table === "books" ? "books" :
                    table === "edited_volumes" ? "edited_volumes" :
                        "chapters";
            (data || [] as any[]).forEach((r: any) => {
                if (!categoryCounts[r.category]) {
                    categoryCounts[r.category] = { total: 0, articles: 0, books: 0, edited_volumes: 0, chapters: 0, subcategories: new Set() };
                }
                categoryCounts[r.category].total++;
                categoryCounts[r.category][typeKey]++;
                if (r.subcategory)
                    categoryCounts[r.category].subcategories.add(r.subcategory);
            });
        }
        const categories = Object.entries(categoryCounts)
            .sort((a, b) => b[1].total - a[1].total)
            .map(([name, stats]) => ({
            category: name,
            total: stats.total,
            articles: stats.articles,
            books: stats.books,
            chapters: stats.chapters,
            subcategories: Array.from(stats.subcategories).sort()
        }));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        total_texts: categories.reduce((sum, c) => sum + c.total, 0),
                        categories
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 14: Search library by subject
server.tool("library_by_subject", "Find texts by subject/keyword across all academic library tables. Searches title, category, and subcategory fields.", {
    subject: z.string().describe("Subject to search for (phenomenology, embodiment, enactivism, cognition, emotion, poetics, etc.)"),
}, async ({ subject }) => {
    try {
        const allResults: any[] = [];
        for (const table of LIBRARY_TABLES) {
            // Search across title, category, and subcategory for the subject term
            const { data, error } = await supabase
                .from(table)
                .select("file_name, author, title, year, category, subcategory, word_count" +
                (table === "journal_articles" ? ", journal, volume, issue, pages" : "") +
                (table === "books" || table === "edited_volumes" ? ", publisher, editors" : "") +
                (table === "book_chapters" ? ", book_title, editors, publisher, pages" : ""))
                .or(`title.ilike.%${subject}%,category.ilike.%${subject}%,subcategory.ilike.%${subject}%`);
            if (error)
                throw error;
            (data || [] as any[]).forEach((r: any) => {
                allResults.push({
                    file_name: r.file_name,
                    author: r.author,
                    title: r.title,
                    year: r.year,
                    category: r.category,
                    subcategory: r.subcategory,
                    word_count: r.word_count,
                    _type: getTextType(table),
                    ...getTypeSpecificMeta(table, r),
                });
            });
        }
        allResults.sort((a, b) => (a.author || "").localeCompare(b.author || ""));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: allResults.length,
                        texts: allResults
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// SEMANTIC SEARCH TOOLS (Vector-based)
// ================================================
// Tool 15: Semantic search across library
server.tool("library_semantic_search", "Semantic search across academic library (journal articles, books, book chapters) - finds conceptually similar texts even without exact keyword matches. Use this for exploratory research queries.", {
    query: z.string().describe("Natural language query (e.g., 'the unity of thought and feeling in poetry')"),
    category: z.string().optional().describe("Optional: limit to category"),
    max_results: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, category, max_results = 20 }) => {
    try {
        const queryEmbedding = await getQueryEmbedding(query);
        const rpcParams = {
            query_embedding: queryEmbedding,
            match_count: max_results,
            search_category: category || null
        };
        // Query all 3 tables in parallel
        const [articlesRes, booksRes, chaptersRes] = await Promise.all([
            supabase.rpc("journal_articles_semantic_search", rpcParams),
            supabase.rpc("books_semantic_search", rpcParams),
            supabase.rpc("book_chapters_semantic_search", rpcParams),
        ]);
        if (articlesRes.error)
            throw articlesRes.error;
        if (booksRes.error)
            throw booksRes.error;
        if (chaptersRes.error)
            throw chaptersRes.error;
        const allResults: any[] = [];
        (articlesRes.data || []).forEach((r) => {
            allResults.push({
                file_name: r.file_name, author: r.author, title: r.title,
                category: r.category, subcategory: r.subcategory, word_count: r.word_count,
                similarity: r.similarity, _type: "article",
                journal: r.journal, volume: r.volume, issue: r.issue, pages: r.pages,
            });
        });
        (booksRes.data || []).forEach((r) => {
            allResults.push({
                file_name: r.file_name, author: r.author, title: r.title,
                category: r.category, subcategory: r.subcategory, word_count: r.word_count,
                similarity: r.similarity, _type: "book",
                publisher: r.publisher, editors: r.editors,
            });
        });
        (chaptersRes.data || []).forEach((r) => {
            allResults.push({
                file_name: r.file_name, author: r.author, title: r.title,
                category: r.category, subcategory: r.subcategory, word_count: r.word_count,
                similarity: r.similarity, _type: "chapter",
                book_title: r.book_title, editors: r.editors, publisher: r.publisher, pages: r.pages,
            });
        });
        // Sort by similarity descending, take top N
        allResults.sort((a, b) => (b.similarity || 0) - (a.similarity || 0));
        const limited = allResults.slice(0, max_results);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        query,
                        count: limited.length,
                        results: limited.map(r => ({ ...r, similarity: r.similarity?.toFixed(3) }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// LITERARY TEXTS TOOLS (Primary creative works)
// ================================================
// Tool: Search literary texts full-text
server.tool("literary_search", "Full-text search across primary literary texts (poetry, drama, novels). Use for finding passages in Shakespeare, Spenser, Milton, Eliot's poems, Rilke, etc.", {
    query: z.string().describe("Search query (e.g., 'to be or not to be' or 'paradise lost')"),
    category: z.string().optional().describe("Optional: limit to category (Early_Modern, Eliot, Milton, Modernism, Other)"),
    max_results: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, category, max_results = 20 }) => {
    try {
        let q = supabase
            .from("literary_texts")
            .select("file_name, author, title, category, subcategory, word_count")
            .textSearch("content", query, { type: "websearch" })
            .limit(max_results);
        if (category)
            q = q.eq("category", category);
        const { data, error } = await q;
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, count: data?.length || 0, results: data }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool: Get literary text content
server.tool("literary_get_text", "Get the full content of a primary literary text (poem, play, novel). Returns plain text blocks (markdown metadata header + body). Read the body to answer; do not display it back as JSON.", {
    file_name: z.string().describe("File name of the literary text"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("literary_texts")
            .select("*")
            .eq("file_name", file_name)
            .single();
        if (error)
            throw error;
        // Same plain-text-blocks pattern as library_get_text: a markdown
        // metadata header, then the actual content as its own block.
        const metaHeader = [
            `# ${data.title || data.file_name}`,
            data.author ? `**Author:** ${data.author}` : null,
            data.year ? `**Year:** ${data.year}` : null,
            data.category ? `**Category:** ${data.category}${data.subcategory ? ` / ${data.subcategory}` : ''}` : null,
            data.word_count ? `**Word count:** ${data.word_count}` : null,
            `**file_name:** \`${data.file_name}\``,
        ].filter(Boolean).join('\n');
        return {
            content: [
                { type: "text", text: metaHeader },
                { type: "text", text: data.content || "(no content stored)" },
            ],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool: Browse literary texts by category
server.tool("literary_browse", "Browse primary literary texts by category (Early_Modern, Eliot, Milton, Modernism, Other)", {
    category: z.string().describe("Category to browse"),
    subcategory: z.string().optional().describe("Optional subcategory (e.g., Shakespeare/Primary, Spenser/Primary)"),
}, async ({ category, subcategory }) => {
    try {
        let q = supabase
            .from("literary_texts")
            .select("file_name, author, title, year, subcategory, word_count")
            .eq("category", category)
            .order("author");
        if (subcategory)
            q = q.eq("subcategory", subcategory);
        const { data, error } = await q;
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, category, count: data?.length || 0, texts: data }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool: Semantic search across literary texts
server.tool("literary_semantic_search", "Semantic search across primary literary texts - finds conceptually similar poems, plays, or novels.", {
    query: z.string().describe("Natural language query"),
    max_results: z.number().optional().describe("Max results (default 15)"),
}, async ({ query, max_results = 15 }) => {
    try {
        const queryEmbedding = await getQueryEmbedding(query);
        const { data, error } = await supabase.rpc("literary_semantic_search", {
            query_embedding: queryEmbedding,
            match_count: max_results,
        });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true, query, count: data?.length || 0,
                        results: data?.map((r) => ({
                            file_name: r.file_name, author: r.author, title: r.title,
                            category: r.category, similarity: r.similarity?.toFixed(3)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// Tool 16: Semantic search across close readings
server.tool("readings_semantic_search", "Semantic search across close readings - finds conceptually related analyses even without exact keyword matches.", {
    query: z.string().describe("Natural language query (e.g., 'how imagination bridges sensibility and understanding')"),
    max_results: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, max_results = 20 }) => {
    try {
        const queryEmbedding = await getQueryEmbedding(query);
        const { data, error } = await supabase.rpc("readings_semantic_search", {
            query_embedding: queryEmbedding,
            match_count: max_results
        });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        query,
                        count: data?.length || 0,
                        results: data?.map((r) => ({
                            file_name: r.file_name,
                            author: r.source_author,
                            title: r.source_title,
                            category: r.category,
                            themes: r.themes,
                            similarity: r.similarity?.toFixed(3)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// ARTICLE DRAFTS TOOLS (Unpublished Work)
// ================================================
// Tool 17: Search drafts full-text
server.tool("drafts_search", "Full-text search across unpublished article drafts. Use to find prior writing on a topic.", {
    query: z.string().describe("Search query (e.g., 'dissociation of sensibility' or 'Milton auditory')"),
    project: z.string().optional().describe("Optional: limit to project (Milton, Scrupulosity, Impersonality, etc.)"),
    max_results: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, project, max_results = 20 }) => {
    try {
        let rpcName = project ? "drafts_search_project" : "drafts_search";
        let params: any = { search_query: query, max_results };
        if (project)
            params.search_project = project;
        const { data, error } = await supabase.rpc(rpcName, params);
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        results: data?.map((r) => ({
                            file_name: r.file_name,
                            title: r.title,
                            project: r.project,
                            draft_type: r.draft_type,
                            word_count: r.word_count,
                            relevance: r.rank
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 18: Get draft content
server.tool("drafts_get_content", "Get the full content of an unpublished draft. Returns plain text blocks (markdown metadata header + body). Read the body to answer; do not display it back as JSON.", {
    file_name: z.string().describe("File name of the draft"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("article_drafts")
            .select("*")
            .eq("file_name", file_name)
            .single();
        if (error)
            throw error;
        // Same plain-text-blocks pattern as library_get_text.
        const metaHeader = [
            `# ${data.title || data.file_name}`,
            data.project ? `**Project:** ${data.project}` : null,
            data.draft_type ? `**Draft type:** ${data.draft_type}` : null,
            data.topics?.length ? `**Topics:** ${(Array.isArray(data.topics) ? data.topics : [data.topics]).join(', ')}` : null,
            data.word_count ? `**Word count:** ${data.word_count}` : null,
            `**file_name:** \`${data.file_name}\``,
        ].filter(Boolean).join('\n');
        return {
            content: [
                { type: "text", text: metaHeader },
                { type: "text", text: data.content || "(no content stored)" },
            ],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 19: List drafts by project
server.tool("drafts_list_project", "List all drafts in a specific project", {
    project: z.string().describe("Project name (Milton, Scrupulosity, Impersonality, Dissertation, etc.)"),
}, async ({ project }) => {
    try {
        const { data, error } = await supabase.rpc("drafts_by_project_list", { search_project: project });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        project,
                        count: data?.length || 0,
                        drafts: data
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 20: List all projects
server.tool("drafts_list_projects", "List all draft projects with counts", {}, async () => {
    try {
        const { data, error } = await supabase
            .from("article_drafts")
            .select("project, word_count");
        if (error)
            throw error;
        const byProject: Record<string, {count: number; words: number}> = {};
        (data || []).forEach(r => {
            if (!byProject[r.project])
                byProject[r.project] = { count: 0, words: 0 };
            byProject[r.project].count++;
            byProject[r.project].words += r.word_count || 0;
        });
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        projects: Object.entries(byProject)
                            .sort((a, b) => b[1].words - a[1].words)
                            .map(([name, stats]) => ({ name, ...stats }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// Tool 21: Semantic search across drafts
server.tool("drafts_semantic_search", "Semantic search across unpublished drafts - finds conceptually related writing even without exact keyword matches.", {
    query: z.string().describe("Natural language query (e.g., 'the relationship between form and feeling')"),
    project: z.string().optional().describe("Optional: limit to project"),
    max_results: z.number().optional().describe("Max results (default 15)"),
}, async ({ query, project, max_results = 15 }) => {
    try {
        const queryEmbedding = await getQueryEmbedding(query);
        const { data, error } = await supabase.rpc("drafts_semantic_search", {
            query_embedding: queryEmbedding,
            match_count: max_results,
            search_project: project || null
        });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        query,
                        count: data?.length || 0,
                        results: data?.map((r) => ({
                            file_name: r.file_name,
                            title: r.title,
                            project: r.project,
                            draft_type: r.draft_type,
                            word_count: r.word_count,
                            similarity: r.similarity?.toFixed(3)
                        }))
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// ANNOTATION TOOLS — user notes + extracted Kindle handwriting
// ================================================
server.tool("library_get_user_notes", "Get the user's hand-written notes/highlights for a library text. Returns all annotations Justin made in the in-app reader (quoted passages with comments, plus pinned notes).", {
    file_name: z.string().describe("file_name of the library text (e.g., 'Levin_Ingressing_Minds')"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("library_annotations")
            .select("id, quote, comment, page_num, pinned, created_at, updated_at")
            .eq("text_file_name", file_name)
            .order("page_num", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        file_name,
                        count: data?.length || 0,
                        notes: data || [],
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("library_get_kindle_annotations", "Get extracted handwritten Kindle annotations for a library text. These are Justin's marginal notes, underlines, and questions extracted via GPT-4o Vision from the annotated PDF.", {
    file_name: z.string().describe("file_name of the library text"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("annotations")
            .select("id, page_number, passage_ref, annotation_text, annotation_type, created_at")
            .eq("text_file_name", file_name)
            .order("page_number", { ascending: true, nullsFirst: false })
            .order("created_at", { ascending: true });
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        file_name,
                        count: data?.length || 0,
                        annotations: data || [],
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("library_get_annotations", "Get ALL notes and annotations for a library text — both the user's in-app notes (library_annotations) and the extracted handwritten Kindle annotations (annotations). Use this when you want a complete picture of what Justin has marked up on a text.", {
    file_name: z.string().describe("file_name of the library text"),
}, async ({ file_name }) => {
    try {
        const [userRes, kindleRes] = await Promise.all([
            supabase
                .from("library_annotations")
                .select("id, quote, comment, page_num, pinned, created_at")
                .eq("text_file_name", file_name)
                .order("page_num", { ascending: true, nullsFirst: false }),
            supabase
                .from("annotations")
                .select("id, page_number, passage_ref, annotation_text, annotation_type, created_at")
                .eq("text_file_name", file_name)
                .order("page_number", { ascending: true, nullsFirst: false }),
        ]);
        if (userRes.error)
            throw userRes.error;
        if (kindleRes.error)
            throw kindleRes.error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        file_name,
                        user_notes: {
                            count: userRes.data?.length || 0,
                            items: userRes.data || [],
                        },
                        kindle_annotations: {
                            count: kindleRes.data?.length || 0,
                            items: kindleRes.data || [],
                        },
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// ================================================
// BIBLIOGRAPHY_ENTRIES — batch-generated analytical material (triage sheets,
// close-reads, DATM reports). Canonical table; do not duplicate into drafts.
// ================================================
server.tool("bibliography_list", "List entries in bibliography_entries. These are batch-generated analytical artifacts (triage sheets, per-source close-reads, DATM reports) produced by Modal pipelines and keyed by file_name. Rows prefixed with '_' are analytical outputs; rows without a '_' prefix are per-source annotated bibliography entries.", {
    project_slug: z.string().optional().describe("Optional: limit to a project (e.g., 'impersonality')"),
    prefix: z.string().optional().describe("Optional file_name prefix filter (e.g., '_eliot_vol1_closeread' or '_triage')"),
    max_results: z.number().optional().describe("Max results (default 100)"),
}, async ({ project_slug, prefix, max_results = 100 }) => {
    try {
        let q = supabase
            .from("bibliography_entries")
            .select("file_name, project_slug, source_table, word_count, batch_id")
            .order("file_name");
        if (project_slug)
            q = q.eq("project_slug", project_slug);
        if (prefix)
            q = q.like("file_name", `${prefix}%`);
        q = q.limit(max_results);
        const { data, error } = await q;
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ success: true, count: data?.length || 0, entries: data || [] }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("bibliography_get_content", "Get the full entry_markdown of a bibliography_entries row by file_name. Use for reading triage sheets, close-reads, DATM reports, or per-source annotated bibliography entries.", {
    file_name: z.string().describe("file_name of the entry (e.g., '_triage_sheet', '_datm_foster_report', '_eliot_vol1_closeread__Eliot_Knowledge_and_Experience__ch1')"),
}, async ({ file_name }) => {
    try {
        const { data, error } = await supabase
            .from("bibliography_entries")
            .select("file_name, entry_markdown, project_slug, source_table, word_count, batch_id, generated_at")
            .eq("file_name", file_name)
            .maybeSingle();
        if (error)
            throw error;
        if (!data) {
            return { content: [{ type: "text", text: JSON.stringify({ error: `No entry with file_name='${file_name}'` }) }] };
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        metadata: {
                            file_name: data.file_name,
                            project_slug: data.project_slug,
                            source_table: data.source_table,
                            word_count: data.word_count,
                            batch_id: data.batch_id,
                            generated_at: data.generated_at,
                        },
                        content: data.entry_markdown,
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("bibliography_search", "Full-text search across bibliography_entries.entry_markdown. Use to find which close-read, triage row, or DATM atom mentions a given concept or author.", {
    query: z.string().describe("Search query (keyword or phrase)"),
    project_slug: z.string().optional().describe("Optional: limit to a project slug"),
    max_results: z.number().optional().describe("Max results (default 20)"),
}, async ({ query, project_slug, max_results = 20 }) => {
    try {
        let q = supabase
            .from("bibliography_entries")
            .select("file_name, project_slug, word_count, batch_id, entry_markdown")
            .ilike("entry_markdown", `%${query}%`)
            .order("file_name")
            .limit(max_results);
        if (project_slug)
            q = q.eq("project_slug", project_slug);
        const { data, error } = await q;
        if (error)
            throw error;
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: data?.length || 0,
                        results: (data || []).map(r => {
                            const text = r.entry_markdown || "";
                            const idx = text.toLowerCase().indexOf(query.toLowerCase());
                            const snippet = idx >= 0 ? text.slice(Math.max(0, idx - 120), idx + 280) : text.slice(0, 300);
                            return {
                                file_name: r.file_name,
                                project_slug: r.project_slug,
                                word_count: r.word_count,
                                batch_id: r.batch_id,
                                snippet,
                            };
                        }),
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("library_find_quote", "Look up a quotation in a library PDF and return the page number + exact surrounding text. Use BEFORE committing any quotation to a draft so the citation carries a correct page. Tries exact match first, then normalized (whitespace + quotation-style) match, then a word-sequence fuzzy match for OCR drift. Returns every page where the quote appears (usually 1). For close-reading work where you need to read the surrounding argument (not just confirm the page), pass max_context: 4000–6000. The default of 2500 is enough for a paragraph of context but cuts off mid-thought on longer arguments.", {
    file_name: z.string().describe("file_name of the library row (journal_articles / books / book_chapters / literary_texts / edited_volumes)"),
    quote: z.string().describe("The quoted passage (can be approximate; matcher is OCR-drift tolerant)"),
    max_context: z.number().optional().describe("Chars of surrounding context to return per hit (default 2500). Bump to 4000–6000 for close-reading work that needs the full argument unit around the quote."),
}, async ({ file_name, quote, max_context = 2500 }) => {
    try {
        let pageTexts: any = null;
        let foundTable: string | null = null;
        let title: string | null = null;
        let author: string | null = null;
        for (const table of [...LIBRARY_TABLES, "literary_texts"]) {
            const { data } = await supabase
                .from(table)
                .select("file_name, title, author, page_texts")
                .eq("file_name", file_name)
                .limit(1);
            if (data && data.length && data[0].page_texts) {
                pageTexts = data[0].page_texts;
                foundTable = table;
                title = data[0].title;
                author = data[0].author;
                break;
            }
            if (data && data.length && !data[0].page_texts) {
                // Row exists but page_texts not populated yet — tell the caller precisely.
                return {
                    content: [{
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                reason: "page_texts_unpopulated",
                                file_name,
                                table,
                                note: "This source exists in the library but its per-page text has not been extracted yet. Run `modal run pipeline.py::backfill` or re-OCR. Without page_texts, this tool cannot return a page number.",
                            }, null, 2),
                        }],
                };
            }
        }
        if (!pageTexts || !foundTable) {
            return {
                content: [{
                        type: "text",
                        text: JSON.stringify({ success: false, reason: "file_not_found", file_name }, null, 2),
                    }],
            };
        }
        // Normalizer: unify curly quotes + collapse whitespace + lowercase.
        const norm = (s) => s
            .replace(/[\u2018\u2019\u201B]/g, "'")
            .replace(/[\u201C\u201D\u201F]/g, '"')
            .replace(/[\u2013\u2014]/g, "-")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        const needleNorm = norm(quote);
        const needleWords = needleNorm.split(/\s+/).filter(Boolean);
        const hits: any[] = [];
        for (const p of pageTexts) {
            const pageText = p.text || "";
            if (!pageText)
                continue;
            // 1) Exact match (verbatim, case-sensitive)
            const exactIdx = pageText.indexOf(quote);
            if (exactIdx >= 0) {
                const ctxStart = Math.max(0, exactIdx - Math.floor(max_context / 2));
                const ctxEnd = Math.min(pageText.length, exactIdx + quote.length + Math.floor(max_context / 2));
                hits.push({
                    page: p.page,
                    match_type: "exact",
                    exact_text: pageText.slice(exactIdx, exactIdx + quote.length),
                    context: pageText.slice(ctxStart, ctxEnd),
                    char_offset_in_page: exactIdx,
                });
                continue;
            }
            // 2) Normalized match — handles curly quotes, whitespace churn, case.
            const pageNorm = norm(pageText);
            const normIdx = pageNorm.indexOf(needleNorm);
            if (normIdx >= 0) {
                // Walk the original text to recover the un-normalized span.
                // Approximate: scan original text and count normalized chars.
                let origStart = -1, origEnd = -1, normCursor = 0;
                const lowerPage = pageText.toLowerCase();
                for (let i = 0; i < pageText.length; i++) {
                    // Fold this char through the same transforms as norm() for counting.
                    const ch = lowerPage[i]
                        .replace(/[\u2018\u2019\u201B]/g, "'")
                        .replace(/[\u201C\u201D\u201F]/g, '"')
                        .replace(/[\u2013\u2014]/g, "-");
                    const isSpace = /\s/.test(ch);
                    // norm() collapses runs of whitespace to single space and trims.
                    const prevWasSpaceInNorm = normCursor === 0 || pageNorm[normCursor - 1] === " ";
                    if (isSpace) {
                        if (prevWasSpaceInNorm)
                            continue; // collapsed
                        if (origStart < 0 && normCursor === normIdx)
                            origStart = i;
                        normCursor++;
                        if (normCursor === normIdx + needleNorm.length) {
                            origEnd = i;
                            break;
                        }
                        continue;
                    }
                    if (origStart < 0 && normCursor === normIdx)
                        origStart = i;
                    normCursor++;
                    if (normCursor === normIdx + needleNorm.length) {
                        origEnd = i + 1;
                        break;
                    }
                }
                if (origStart < 0)
                    origStart = 0;
                if (origEnd < 0)
                    origEnd = Math.min(pageText.length, origStart + quote.length);
                const ctxStart = Math.max(0, origStart - Math.floor(max_context / 2));
                const ctxEnd = Math.min(pageText.length, origEnd + Math.floor(max_context / 2));
                hits.push({
                    page: p.page,
                    match_type: "normalized",
                    exact_text: pageText.slice(origStart, origEnd),
                    context: pageText.slice(ctxStart, ctxEnd),
                    char_offset_in_page: origStart,
                });
                continue;
            }
            // 3) Fuzzy word-sequence — OCR drift (missing word, split line, etc).
            //    Require 80% of the quote's words to appear in order within a
            //    window of 1.5× the quote length on this page.
            if (needleWords.length >= 6) {
                const pageWords = pageNorm.split(/\s+/);
                const targetHits = Math.max(5, Math.floor(needleWords.length * 0.8));
                const windowSize = Math.floor(needleWords.length * 1.5);
                for (let start = 0; start <= pageWords.length - targetHits; start++) {
                    const win = pageWords.slice(start, start + windowSize);
                    let matched = 0;
                    let wi = 0;
                    for (const w of win) {
                        if (wi < needleWords.length && w === needleWords[wi]) {
                            matched++;
                            wi++;
                        }
                    }
                    if (matched >= targetHits) {
                        // Approximate character offset via word count.
                        const approxChar = pageText.split(/\s+/).slice(0, start).join(" ").length;
                        const ctxStart = Math.max(0, approxChar - 80);
                        const ctxEnd = Math.min(pageText.length, approxChar + Math.floor(max_context));
                        hits.push({
                            page: p.page,
                            match_type: "fuzzy_word_sequence",
                            exact_text: pageText.slice(ctxStart, ctxEnd),
                            context: pageText.slice(ctxStart, ctxEnd),
                            char_offset_in_page: approxChar,
                        });
                        break;
                    }
                }
            }
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        file_name,
                        table: foundTable,
                        title,
                        author,
                        total_pages: pageTexts.length,
                        hit_count: hits.length,
                        hits,
                        note: hits.length === 0
                            ? "Quote not found on any page. Either the quotation is not verbatim (common) or the source is a scanned PDF without a text layer. Do not cite without verification — re-read the source, or use library_get_text to locate an exact passage."
                            : hits.some(h => h.match_type === "exact")
                                ? "At least one exact match found. Cite that page."
                                : "Only approximate matches found. Verify the exact wording against `exact_text` before citing — the quote may have been paraphrased.",
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
server.tool("drafts_check_style", "Audit a draft against Justin's composition-style constraints. Returns violations with paragraph/sentence locations so the model can revise before committing. Persists the draft + violations to Supabase (drafts_check_history) for later pair-mining; when violations are found, attaches up to 2 similar past corrections (rejected→chosen pairs) inline so the model can see how analogous mistakes were fixed before. Rules cover Final-Pass Strictures (em dashes, banned words, catch phrases, naming/revelation verbs, contrastive hinges, passive voice, scholar-name openings, repeated opening words) and the absolute composition rules' mechanically-detectable cases (relative-pronoun openers, relative-clause subjects, requirement-announcer openers, coordinated-and handoffs, title-plus-function in S1–S3, ±2-paragraph first-word repeats, cross-paragraph scholar-as-subject, past tense on writers, mid-sentence citations, straight quotes, noun-phrase totems). Paragraph length 200–350 is checked but is disregarded by the Inquiry project per its instructions.", {
    draft: z.string().describe("The draft text to audit (markdown or plain text)."),
    project_slug: z.string().optional().describe("Optional project slug for tagging the history row."),
    attach_corrections: z.boolean().optional().default(true).describe("If true (default) and violations are found, attach up to 2 similar past (rejected, chosen) pairs."),
}, async ({ draft, project_slug, attach_corrections }) => {
    const violations: any[] = [];
    // Paragraphs = blocks separated by blank lines. Skip H1/H2/H3 lines for length checks.
    const rawParas = draft.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
    // Split a paragraph into sentences. Respect abbreviations minimally.
    const splitSentences = (p: string): string[] => {
        // Collapse whitespace, strip markdown heading marks from count-irrelevant lines.
        const s = p.replace(/\s+/g, " ").trim();
        // Naive sentence splitter: split on . ! ? followed by space + capital.
        const out: string[] = [];
        const re = /([^.!?]+[.!?]+)(?=\s|$)/g;
        let m;
        while ((m = re.exec(s)) !== null)
            out.push(m[1].trim());
        // Trailing fragment
        const consumed = out.join(" ").length;
        const tail = s.slice(consumed).trim();
        if (tail)
            out.push(tail);
        return out.filter(Boolean);
    };
    const BANNED_WORDS = [
        "tensions", "interplay", "nuanced", "grapples", "exploration",
        "landscape", "journey", "moreover",
    ];
    // Catch phrases: ready-made connective/hedging/AI-mode locutions that
    // read as filler rather than argument. Each phrase is matched as a
    // contiguous word sequence (word-boundary start/end, case-insensitive).
    // Catch phrases are distinct from banned_words because they're multi-
    // word idioms whose individual words are unobjectionable — the issue
    // is the frozen combination. Flagged severity: "catch_phrase".
    const CATCH_PHRASES = [
        // AI-mode connectives and framing
        "it is important to note", "it is worth noting", "it should be noted",
        "it bears mentioning", "it goes without saying", "needless to say",
        "this raises the question", "offers insight into", "speaks to",
        "shed(s)? light on", "sheds light on", "delve(s)? into",
        "navigate(s)? the complexities", "at its core", "at the heart of",
        "rich tapestry", "multifaceted", "a growing body of",
        "a wealth of", "a host of", "a myriad of",
        // Generic academic filler
        "in many ways", "in a sense", "in some sense", "to some extent",
        "in the final analysis", "in a very real sense",
        "for what it's worth", "on some level",
        // Substanceless transitions (beyond the single-word list)
        "furthermore", "in addition", "that being said", "having said that",
        "with that said", "in light of", "in terms of",
        // Hedging catch phrases
        "arguably", "one could argue", "one might say",
        // Empty amplifiers
        "deeply", "profoundly", "fundamentally", "ultimately",
        // Revelation-adjacent predicates the single-word list misses
        "highlights", "underscores", "underlines", "points to",
        "speaks volumes", "offers a glimpse",
    ];
    const NAMING_PREDICATES = [
        "names", "designates", "denotes", "captures", "signals",
        "marks", "indicates", "identifies", "stands for",
    ];
    const REVELATION_VERBS = ["reveals", "shows", "demonstrates", "illustrates"];
    // Bland function-verbs from Rule 5: when these head the action of an
    // opener (sentence 1 of a paragraph), the opener is doing a generic
    // gesture rather than a specific move. Detected as "[Scholar/Subject]
    // + bland verb" at the start of a paragraph's first sentence.
    const BLAND_OPENER_VERBS = [
        "gives", "supplies", "develops", "opens", "makes",
        "articulates", "captures", "turns", "takes", "draws",
        "brings", "holds", "works", "sets", "puts",
        "turns on", "draws from", "draws on", "works through",
        "takes up", "takes on", "sets out", "lays out", "puts forward",
        "comes to", "goes to", "gets at",
    ];
    const IMPERSONAL_SUBJECTS = [
        "the article", "this article", "the section", "this section",
        "the paragraph", "this paragraph", "the argument", "this argument",
        "the essay", "this essay", "the chapter", "this chapter",
    ];
    const IMPERSONAL_VERBS = [
        "claims", "argues", "suggests", "proposes", "contends", "maintains",
        "holds", "develops", "specifies", "establishes", "shows", "reveals",
        "demonstrates", "names", "transitions", "turns", "locates",
    ];
    // Abstract nouns that genuinely cannot act — flagged as the agent of a person-
    // verb whether or not they carry an article ("Diagnosis asks" drops the article
    // to evade the IMPERSONAL_SUBJECTS form). Deliberately EXCLUDES the skill's
    // licensed agents (the account, the analysis, the substitution, the predicative
    // work, the picture, the centre) so the recommended fixes don't get flagged.
    const IMPERSONAL_NOUNS = [
        "criterion", "formula", "carrier", "exchange", "diagnosis", "hylomorphism",
        "reduction", "rubric", "deflation", "objectification", "configuration",
    ];
    // Action verbs an abstraction can't be the agent of (base + -s forms so a modal
    // case like "a formula can wed" is caught alongside "the criterion relocates").
    const IMPERSONAL_ACTION_VERBS = [
        "relocates", "relocate", "occasions", "occasion", "weds", "wed", "fuses",
        "fuse", "asks", "ask", "reaches", "reach", "does", "do", "makes", "make",
        "keeps", "keep", "carries", "carry", "drops", "drop", "joins", "join",
        "retires", "retire", "annihilates", "annihilate", "wants", "want",
    ];
    // Convergence / anticipation framing — never claim a source arrives at the same
    // place as the position (read thinking-with, not as an ally who agrees).
    const CONVERGENCE_PATTERNS = [
        /\breach(?:es|ed)?\s+the\s+same\b/i,
        /\banticipat(?:e|es|ed|ion|ing)\b/i,
        /\bconverg(?:e|es|ed|ence|ing)\b/i,
        /\barriv(?:e|es|ed)\s+at\s+the\s+same\b/i,
        /\bthe\s+same\s+(?:structure|conclusion|move|result|account|point|position|diagnosis)\b/i,
    ];
    const CONTRASTIVE_HINGES = [
        /\bnot\b[^,.;]{1,60},\s*but\b/i,
        /\brather than\b/i,
        /\bwhile\s+[A-Za-z][^,.;]{2,60},\s*[A-Za-z]/i, // "While X, Y"
        /\binstead of\b/i,
        /\bneither\b[^,.;]{1,80}\bnor\b/i,
        /\balthough\b/i, // "Although X, Y"
        /\bwhereas\b/i, // "X, whereas Y"
        /\bnot only\b[^,.;]{1,80}\bbut also\b/i, // "not only X but also Y"
        /\bon the one hand\b[^.]{1,200}\bon the other\b/i, // paired-hands construction
        /\beven as\b/i, // "even as X, Y" — contrastive simultaneity
        /\bthough\b\s+[A-Za-z][^,.;]{2,60},\s*[A-Za-z]/i, // "Though X, Y" at sentence start
    ];
    // Vague framing / filler phrases (composition-style §The Voice — reserve power,
    // say the thing). Scope-intensifier openers ("At its limit", "At bottom"),
    // discourse-deferral tags ("in the final analysis", "to be sure"), colloquial
    // free-relatives ("what it takes for…"), and informal depth metaphors
    // ("goes deeper still"). Each gestures at significance without doing the work;
    // they pass every grammar rule clean. Run on quote-stripped prose.
    const FLUFF_PHRASES = [
        /\bat its limit\b/i, /\bat bottom\b/i, /\bin the final analysis\b/i,
        /\bat the end of the day\b/i, /\bwhen all is said and done\b/i,
        /\bfor its part\b/i, /\bto be sure\b/i, /\bin a sense\b/i,
        /\bin some sense\b/i, /\bon some level\b/i, /\bthe way forward\b/i,
        /\bneedless to say\b/i, /\bit goes without saying\b/i, /\bat heart\b/i,
        /\bin truth\b/i, /\bwhat it takes (?:for|to)\b/i, /\bgoes? deeper\b/i,
        /\bdeeper still\b/i, /\ball the way down\b/i, /\bwhen you get (?:right )?down to it\b/i,
    ];
    // Scholars: sentence opener like "Lastname" or "Firstname Lastname" followed by
    // possessive, a year in parens, or an attribution verb within ~10 words.
    const ATTRIBUTION_VERBS = [
        "argues", "claims", "writes", "notes", "proposes", "defends", "observes",
        "suggests", "maintains", "contends", "holds", "says", "locates", "specifies",
        "develops", "treats", "reads", "recognizes", "distinguishes", "builds",
        "organizes", "defines",
    ];
    // Relative pronouns banned as sentence openers (Rule 5).
    const RELATIVE_PRONOUN_OPENERS = new Set([
        "Which", "Where", "What", "That", "Who", "Whom", "Whose",
    ]);
    // Scholars frequently cited in Justin's projects. Used for:
    //  - past-tense detection (Rule 8: present tense on writers/sources)
    //  - cross-paragraph scholar-as-grammatical-subject tracking (Rule 7)
    const SCHOLARS_USED = [
        "Eliot", "Bradley", "Chalmers", "Cappelen", "Hawthorne", "Butlin", "List",
        "Quine", "Putnam", "Kripke", "Rorty", "Russell", "Husserl", "Carnap",
        "Mander", "Henry", "Simondon", "Levin", "Matherne", "Frankfurt", "Davidson",
        "Heil", "Knobe", "Prasada", "Haslanger", "Kramnick",
        "Kant", "Hegel", "Aristotle", "Plato", "Leibniz",
        "Bosanquet", "Green", "Caird", "McTaggart", "Collingwood",
        "Foster", "Ford", "Martel", "Anscombe", "Velleman", "Korsgaard",
        "Bergson", "Whitehead", "Dennett", "Nagel", "Descartes",
    ];
    // Past-tense reportorial verbs that should be present tense per Rule 8.
    // Not exhaustive — picks the most common verbs the chat-Claude has reached for.
    const PAST_TENSE_REPORTORIAL = [
        "took", "drew", "argued", "claimed", "wrote", "noted", "proposed",
        "defended", "observed", "suggested", "maintained", "contended", "held",
        "said", "developed", "specified", "established", "showed", "treated",
        "read", "made", "gave", "kept", "brought", "set", "put",
        "recognized", "distinguished", "built", "organized", "defined",
        "located", "found", "called",
    ];
    const NON_SCHOLAR_OPENERS = new Set([
        "The", "A", "An", "This", "That", "These", "Those", "It", "Its",
        "He", "His", "She", "Her", "They", "Their", "We", "Our", "I", "My",
        "You", "Your", "But", "Yet", "And", "Or", "So", "For", "Nor",
        "What", "Where", "When", "How", "Why", "Because", "If", "In", "On",
        "At", "By", "With", "Without", "Within", "From", "To", "As",
        "Each", "Every", "Some", "All", "No", "None", "Nothing", "Anything",
        "Something", "There", "Here", "Now", "Then", "After", "Before",
        "Above", "Below", "Under", "Over", "Between", "Among", "Against",
        "Eliot", "Bradley", // author-of-study — allow; they're the subject of argument
    ]);
    const openingWord = (sent) => {
        const m = sent.match(/^[“”"']?(\S+)/);
        return (m?.[1] || "").replace(/[^\w'-]/g, "");
    };
    // Blank out quoted spans (the source's words, not the author's prose) so
    // catch-phrase / passive detectors don't fire on quotations. Replaces the
    // interior of "…" / “…” / '…' / ‘…’ runs with spaces, preserving offsets.
    const stripQuoted = (text) =>
        text
            .replace(/[“"']([^“”"']{0,4000}?)[”"']/g, (m) => " ".repeat(m.length))
            // Curly single quotes ‘…’ (Justin's prose default per §Quotation
            // Protection). Safe against possessives: a possessive uses ’ (U+2019)
            // alone, which can't open a span without a leading ‘ (U+2018).
            .replace(/‘([^‘’]{0,4000}?)’/g, (m) => " ".repeat(m.length));
    // Stative / adjectival past-participles. "is grounded in", "is based on",
    // "is concerned with" etc. are copular + adjective, not eventive passives —
    // flagging them was the bulk of possible_passive's false positives (25%
    // resolution rate in the miner). Skip the flag when the participle is one
    // of these, so the rule catches real agentless passives instead of noise.
    const STATIVE_PARTICIPLES = new Set([
        "based", "grounded", "concerned", "interested", "committed", "related",
        "suited", "situated", "rooted", "premised", "predicated", "involved",
        "bound", "supposed", "meant", "inclined", "disposed", "attuned",
        "devoted", "dedicated", "aligned", "tied", "linked", "geared", "oriented",
    ]);
    const isScholarOpening = (sent) => {
        const m = sent.match(/^([A-Z][a-zA-Z.-]+)(?:\s+([A-Z][a-zA-Z.-]+))?(?:\s+([A-Z][a-zA-Z.-]+))?/);
        if (!m)
            return false;
        const first = m[1];
        if (NON_SCHOLAR_OPENERS.has(first))
            return false;
        // Possessive within first 3 tokens: "Barrett's" or "Dan Zahavi's"
        if (/^[A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+){0,2}['’]s\b/.test(sent))
            return true;
        // Year in parens within first ~10 words
        const head = sent.split(/\s+/).slice(0, 10).join(" ");
        if (/\(\s*\d{4}\s*\)/.test(head))
            return true;
        // Attribution verb within first ~8 words
        const words = sent.split(/\s+/).slice(0, 10).join(" ").toLowerCase();
        for (const v of ATTRIBUTION_VERBS) {
            if (new RegExp(`\\b${v}\\b`).test(words))
                return true;
        }
        return false;
    };
    // -ing words that are NOT verb-gerunds (so a sentence opening on one isn't
    // mistaken for a fronted-participle operation). Nouns, prepositions, fixed forms.
    const NON_GERUND_ING = new Set([
        "nothing", "something", "anything", "everything", "morning", "evening",
        "king", "thing", "being", "during", "ceiling", "spring", "string", "ring",
        "wing", "sibling", "offspring", "darling", "ending", "beginning",
    ]);
    const isGerundOpener = (w) =>
        !!w && /^[a-z]+ing$/i.test(w) && w.length > 4 && !NON_GERUND_ING.has(w.toLowerCase());
    // Cross-paragraph trackers (filled during the loop, checked after).
    const paraFirstWords: any[] = [];
    const paraScholarSubjects: any[] = [];
    const paraOpenerGerunds: any[] = []; // paragraphs whose FIRST sentence opens on a gerund participle
    rawParas.forEach((para, pIdx) => {
        const pNum = pIdx + 1;
        // Skip headings (markdown # / ## / ### / setext)
        if (/^#{1,6}\s/.test(para) || /^-{3,}$/.test(para) || /^={3,}$/.test(para))
            return;
        // Length check (word count)
        const wc = para.split(/\s+/).filter(Boolean).length;
        if (wc < 200 && wc >= 40) {
            violations.push({ rule: "paragraph_length_short", paragraph: pNum, snippet: para.slice(0, 120), note: `${wc} words (target 200–350)` });
        }
        if (wc > 350) {
            violations.push({ rule: "paragraph_length_long", paragraph: pNum, snippet: para.slice(0, 120), note: `${wc} words (target 200–350)` });
        }
        // Em dashes. Run on quote-stripped text (offsets preserved, so the
        // index maps back to the original) so a dash inside a quotation — the
        // source's punctuation, not the author's — isn't charged. §Quotation
        // Protection: never flag inside quotation marks.
        const paraStripped = stripQuoted(para);
        if (/—|–|--/.test(paraStripped)) {
            const idx = paraStripped.search(/—|–|--/);
            violations.push({ rule: "em_dash", paragraph: pNum, snippet: para.slice(Math.max(0, idx - 40), idx + 41).trim() });
        }
        const lower = para.toLowerCase();
        // Banned words
        for (const w of BANNED_WORDS) {
            const re = new RegExp(`\\b${w}\\b`, "i");
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "banned_word", paragraph: pNum, snippet: m[0], note: w });
        }
        // Banned filler verbs (explicit). "bears"/"holds" as the verb, with idiom
        // carve-outs (bear in mind; holds that/true/good/for). NOTE: "the thesis
        // holds" (= obtains) also trips — flagged per instruction; recast or ignore.
        const bannedVerb = paraStripped.match(/\bbears?\b(?!\s+in\s+mind)|\bbearing\b|\bborne\b|\bholds?\b(?!\s+(?:that|true|good|for)\b)|\bcarr(?:y|ies|ied|ying)\b(?!\s+(?:out|on)\b)/i);
        if (bannedVerb)
            violations.push({ rule: "banned_verb", paragraph: pNum, snippet: bannedVerb[0], note: `"${bannedVerb[0]}" is a banned filler verb — replace with a verb that names the specific operation (what does the thing actually do to its object?)` });
        // Catch phrases (multi-word locutions). Match on quote-stripped text so
        // a catch-phrase quoted FROM a source ("the fuel and fire of thinking")
        // isn't charged against the author's own prose.
        const paraNoQuotes = paraStripped;
        for (const phrase of CATCH_PHRASES) {
            const re = new RegExp(`\\b${phrase}\\b`, "i");
            const m = paraNoQuotes.match(re);
            if (m) {
                const startIdx = para.toLowerCase().indexOf(m[0].toLowerCase());
                const ctxStart = Math.max(0, startIdx - 30);
                const ctxEnd = Math.min(para.length, startIdx + m[0].length + 40);
                violations.push({
                    rule: "catch_phrase",
                    paragraph: pNum,
                    snippet: para.slice(ctxStart, ctxEnd),
                    note: `"${m[0]}" — ready-made connective/hedging/AI-mode locution; replace with argument-specific language or cut`,
                });
            }
        }
        // Naming predicates (as predicate, with subject right before)
        for (const pred of NAMING_PREDICATES) {
            const re = new RegExp(`\\b[A-Za-z]+\\s+${pred}\\b`, "i");
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "naming_predicate", paragraph: pNum, snippet: m[0], note: pred });
        }
        // Revelation verbs
        for (const v of REVELATION_VERBS) {
            const re = new RegExp(`\\b${v}\\b`, "i");
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "revelation_verb", paragraph: pNum, snippet: m[0], note: v });
        }
        // "Conceptual force"
        if (/\bconceptual force\b/i.test(paraStripped)) {
            violations.push({ rule: "conceptual_force", paragraph: pNum, snippet: "conceptual force" });
        }
        // Impersonal noun-phrase subjects: "The article claims" etc.
        for (const subj of IMPERSONAL_SUBJECTS) {
            for (const v of IMPERSONAL_VERBS) {
                const re = new RegExp(`\\b${subj}\\s+${v}\\b`, "i");
                const m = paraStripped.match(re);
                if (m)
                    violations.push({ rule: "impersonal_subject", paragraph: pNum, snippet: m[0] });
            }
        }
        // Contrastive hinges
        for (const re of CONTRASTIVE_HINGES) {
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "contrastive_hinge", paragraph: pNum, snippet: m[0].trim().slice(0, 100) });
        }
        // Can't-act abstraction as the agent of a person-verb. Article-optional and
        // modal-tolerant, so "the criterion relocates", "an exchange occasions", the
        // article-dropped "Diagnosis asks", and "a formula can wed" all trip.
        for (const noun of IMPERSONAL_NOUNS) {
            const re = new RegExp(`(?:^|[.;:!?]\\s+|\\b(?:the|a|an|this|that|its|their)\\s+)${noun}\\s+(?:(?:can|could|may|must|will|would|should)\\s+)?(${IMPERSONAL_ACTION_VERBS.join("|")})\\b`, "i");
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "impersonal_subject", paragraph: pNum, snippet: m[0].trim().slice(0, 80), note: `"${noun}" cannot be the agent of "${m[1]}" — name the actual actor (a centre, the account, Eliot) or recast so a person/located subject acts` });
        }
        // Empty-agency tell: an abstraction "doing the X" — work / damage / heavy
        // lifting / job / trick / rest. "The second stipulation does the damage."
        const doesWork = paraStripped.match(/\b(?:does|do|doing|did)\s+the\s+(?:work|damage|heavy\s+lifting|lifting|legwork|job|trick|rest|business)\b/i);
        if (doesWork)
            violations.push({ rule: "empty_agency", paragraph: pNum, snippet: doesWork[0], note: `"${doesWork[0]}" is empty agency ("does the X") — name what the thing specifically does, not that it "does the ${doesWork[0].replace(/.*\bthe\s+/i, "")}"` });
        // Copular non-thoughts: "becomes useful/usable/…", "falls away", "comes into view".
        const copula = paraStripped.match(/\bbecomes?\s+(?:useful|usable|available|possible|clear|apparent|evident|visible|intelligible|legible|relevant|tractable|accessible|necessary|meaningful)\b|\bfalls?\s+away\b|\bcomes?\s+into\s+(?:view|focus)\b/i);
        if (copula)
            violations.push({ rule: "empty_copula", paragraph: pNum, snippet: copula[0].trim(), note: `"${copula[0].trim()}" is a copular non-thought — say what specifically changes and what does the changing, not that something "becomes X"` });
        // Convergence / anticipation claims.
        for (const re of CONVERGENCE_PATTERNS) {
            const m = paraStripped.match(re);
            if (m)
                violations.push({ rule: "convergence_claim", paragraph: pNum, snippet: m[0].trim(), note: `"${m[0].trim()}" frames a source as converging with / anticipating the position — read the source thinking-with, never as arriving at the same place` });
        }
        // Vague framing / filler phrases (quote-stripped — don't flag a quoted source)
        const paraNoQuote = stripQuoted(para);
        for (const re of FLUFF_PHRASES) {
            const m = paraNoQuote.match(re);
            if (m)
                violations.push({
                    rule: "fluff_phrase",
                    paragraph: pNum,
                    snippet: m[0].trim(),
                    note: `"${m[0].trim()}" gestures at significance without doing the work — cut it or replace with the specific claim it stands in for`,
                });
        }
        // Straight quotes / apostrophes (Rule 8 — house style)
        // " = " (straight double), ' = ' (straight single / apostrophe)
        const straightMatch = para.match(/.{0,20}["'].{0,20}/);
        if (straightMatch) {
            violations.push({
                rule: "straight_quote",
                paragraph: pNum,
                snippet: straightMatch[0].trim(),
                note: "Use curly typographic quotes/apostrophes (' ' “ ”)",
            });
        }
        // Past-tense source reference (Rule 8 — present tense on writers)
        // Matches "[Scholar] [past-tense verb]" — e.g., "Eliot took", "Bradley argued".
        // Flags broadly; historical-sequence licensed exceptions are an audit call.
        const pastTenseRe = new RegExp(`\\b(${SCHOLARS_USED.join("|")})(?:['’]s)?\\s+(?:[a-z]+ly\\s+)?(${PAST_TENSE_REPORTORIAL.join("|")})\\b`);
        const pastMatch = para.match(pastTenseRe);
        if (pastMatch) {
            violations.push({
                rule: "past_tense_source_reference",
                paragraph: pNum,
                snippet: pastMatch[0],
                note: `"${pastMatch[1]} ${pastMatch[2]}" — sources are referred to in the present tense (Rule 8)`,
            });
        }
        // Sentence-level checks
        const sentences = splitSentences(para);
        const openings: any[] = [];
        let scholarOpenCount = 0;
        let firstScholarSubject: string | null = null;
        sentences.forEach((s, sIdx) => {
            const ow = openingWord(s);
            openings.push(ow);
            if (isScholarOpening(s)) {
                scholarOpenCount++;
                // Scholar-front opener (concept-leads discipline): a paragraph
                // whose FIRST sentence opens on "Scholar, in *Work* (year),
                // [verb]s…" leads on the survey instead of the concept. The
                // miner's suspect pairs show the chat-Claude rewriting exactly
                // this template unprompted — catch it at audit, not by luck.
                if (sIdx === 0) {
                    violations.push({
                        rule: "scholar_front_opener",
                        paragraph: pNum,
                        sentence: 1,
                        snippet: s.slice(0, 120),
                        note: "Paragraph opens on a scholar+attribution template; lead on the concept/move, seat the scholar mid-sentence",
                    });
                }
            }
            // Passive heuristic: "is/was/were/been/being" + past-participle (-ed/-en).
            // Run on quote-stripped text (don't flag passives inside quotations),
            // and skip stative/adjectival participles ("is grounded in" etc.) that
            // are copular-adjective, not eventive passive.
            const passive = stripQuoted(s).match(/\b(?:is|was|were|are|been|being|be)\s+(?:[a-z]+ly\s+)?([a-z]+ed|[a-z]+en)\b/i);
            if (passive && !STATIVE_PARTICIPLES.has(passive[1].toLowerCase())) {
                violations.push({ rule: "possible_passive", paragraph: pNum, sentence: sIdx + 1, snippet: passive[0] });
            }
            // Relative-pronoun opener (Rule 5)
            if (RELATIVE_PRONOUN_OPENERS.has(ow)) {
                violations.push({
                    rule: "relative_pronoun_opener",
                    paragraph: pNum,
                    sentence: sIdx + 1,
                    snippet: s.slice(0, 80),
                    note: `"${ow}" — recast to lead on a noun or subject`,
                });
            }
            // Free-relative clause as grammatical subject — "what acquaintance
            // furnishes works as…" — the relative-pronoun-opener fault buried
            // mid-sentence. The doubled-verb tell (relative-clause verb + matrix
            // verb) distinguishes a SUBJECT from a free-relative object ("supplies
            // what X could not") or indirect question ("shows what X does"), so it
            // does not fire on those. Quote-stripped; skip if already a relative
            // opener (flagged above). (composition-style §Name the Subject.)
            if (!RELATIVE_PRONOUN_OPENERS.has(ow)) {
                const rcs = stripQuoted(s).match(/\bwhat(?:ever)?\s+(?:the\s+|a\s+|an\s+|his\s+|her\s+|its\s+|their\s+)?[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z'’-]+){0,3}?\s+(?:[a-z]{3,}s|[a-z]{3,}ed)\s+(?:[a-z]+\s+){0,2}(?:is|are|was|were|[a-z]{3,}s)\b/);
                if (rcs) {
                    violations.push({
                        rule: "relative_clause_subject",
                        paragraph: pNum,
                        sentence: sIdx + 1,
                        snippet: rcs[0].slice(0, 90),
                        note: "a free-relative clause ('what …') is doing the work of the grammatical subject — name the noun the clause defers to",
                    });
                }
            }
            // Coordinated-conjunction handoff opener (Rule 5) — at S1 of paragraph.
            // Also flagged as body-sentence variant for all other sentences (Rule 6).
            // Pattern: "...something..., and [Proper noun] [verb]s..." where the
            // proper noun is a fresh subject not the prior clause's subject.
            const coordHandoff = s.match(/^[^,]{10,}?,\s+and\s+([A-Z][a-z]+)(?:'s|\s+([a-z]+(?:s|ed)))/);
            if (coordHandoff) {
                const isOpener = sIdx === 0;
                violations.push({
                    rule: isOpener ? "coord_and_handoff_opener" : "coord_and_handoff_body",
                    paragraph: pNum,
                    sentence: sIdx + 1,
                    snippet: s.slice(0, 120),
                    note: isOpener
                        ? "[setup], and [source] [verb]s it — fold handoff in subordinately or split into two sentences"
                        : "two beats joined with 'and' inside one sentence — subordinate the second beat or split",
                });
            }
            // Mid-sentence citation (Rule 8)
            const citeRe = /\(\s*[A-Z][a-zA-Z'’-]+(?:\s+(?:and|&|et\s+al\.?)\s+[A-Z][a-zA-Z'’-]+)?(?:\s*\[\s*\d{4}[a-z]?\s*\])?\s+\d{4}[a-z]?(?:\s*,\s*\d+(?:[-–]\d+)?[a-z]?)?\s*\)/g;
            let cm;
            while ((cm = citeRe.exec(s)) !== null) {
                const endIdx = cm.index + cm[0].length;
                const remainder = s.slice(endIdx).trim();
                // If there's substantive content after the citation (more than terminal punctuation), it's mid-sentence.
                if (remainder.length > 1 && !/^[.;,:?!]\s*$/.test(remainder)) {
                    violations.push({
                        rule: "mid_sentence_citation",
                        paragraph: pNum,
                        sentence: sIdx + 1,
                        snippet: cm[0] + " ... " + remainder.slice(0, 40),
                        note: "Citations land at sentence end (Rule 8). Restructure so the clause carrying the cited claim becomes its own sentence.",
                    });
                    break;
                }
            }
            // Track first scholar-as-grammatical-subject in this paragraph
            if (firstScholarSubject === null) {
                const subjMatch = s.match(new RegExp(`^(?:${SCHOLARS_USED.join("|")})(?:['’]s)?\\b`));
                if (subjMatch)
                    firstScholarSubject = subjMatch[0].replace(/['’]s$/, "");
            }
        });
        // Title-plus-function in S1, S2, or S3 (Rule 5 extended)
        // Multiple variants of the failure shape:
        //   (a) "In/On 'Title' (Year), [Scholar] [verb]s that..."
        //   (b) "[Scholar Name]'s *Title* (Year) [verb]s..."  (Tyler Burge's Origins of Objectivity (2010) reads...)
        //   (c) "[Scholar Name]'s 'Title' (Year) [verb]s..."  (single-quote variant of b)
        //   (d) "[Scholar] [verb]s in '[Title]' (Year)..."
        const tpfPatterns = [
            // (a) prepositional opener: In/On/Within/At "Title" (Year), Scholar verbs
            /^(?:In|On|Within|At)\s+["“'‘][^"“”'‘’]+["”'’]\s*\(\s*\w*\s*\d{4}[a-z]?\s*\),?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+\w+/,
            // (b) Scholar's *Title* (Year) [verb]s — italicized title
            /^[A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+){0,2}['’]s\s+\*[^*]+\*\s*\(\s*\w*\s*\d{4}[a-z]?\s*\)\s+[a-z]+s?\b/,
            // (c) Scholar's "Title" (Year) [verb]s — straight-quoted title
            /^[A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+){0,2}['’]s\s+["“'‘][^"“”'‘’]+["”'’]\s*\(\s*\w*\s*\d{4}[a-z]?\s*\)\s+[a-z]+s?\b/,
            // (d) Scholar [verb]s in/at/within "Title" (Year) ...
            /^[A-Z][a-zA-Z.-]+(?:\s+[A-Z][a-zA-Z.-]+){0,2}\s+[a-z]+s?\s+(?:in|at|within|on)\s+["“'‘*][^"“”'‘’*]+["”'’*]\s*\(\s*\w*\s*\d{4}[a-z]?\s*\)/,
        ];
        sentences.slice(0, 3).forEach((s, idx) => {
            for (const re of tpfPatterns) {
                if (re.test(s)) {
                    violations.push({
                        rule: "title_plus_function",
                        paragraph: pNum,
                        sentence: idx + 1,
                        snippet: s.slice(0, 140),
                        note: `at S${idx + 1} — title-plus-function header is banned in the paragraph's opening neighborhood (S1–S3), not only S1`,
                    });
                    break; // one hit per sentence is enough
                }
            }
        });
        // Bland function-verb as the action of the paragraph's first sentence (Rule 5).
        // Pattern: paragraph opener whose grammatical subject is a scholar/concept and
        // whose verb is one of the BLAND_OPENER_VERBS list.
        if (sentences.length > 0) {
            const opener = sentences[0];
            // The verb sits in the first ~10 words. Look for a bland verb after a capitalized subject.
            // Multi-word verbs ("turns on", "draws from") need separate handling.
            const head = opener.split(/\s+/).slice(0, 12).join(" ");
            for (const bv of BLAND_OPENER_VERBS) {
                const re = new RegExp(`^([A-Z][a-zA-Z'’.-]+(?:\\s+[A-Z][a-zA-Z'’.-]+){0,3})\\s+${bv.replace(/ /g, "\\s+")}\\b`, "i");
                const m = head.match(re);
                if (m) {
                    violations.push({
                        rule: "bland_opener_verb",
                        paragraph: pNum,
                        sentence: 1,
                        snippet: opener.slice(0, 140),
                        note: `bland verb "${bv}" as the action of the opener — replace with a verb that names the specific operation the paragraph performs (Rule 5)`,
                    });
                    break;
                }
            }
        }
        if (scholarOpenCount > 1) {
            violations.push({ rule: "scholar_name_openings", paragraph: pNum, snippet: sentences.slice(0, 4).join(" ").slice(0, 160), note: `${scholarOpenCount} sentences open with scholar names (max 1)` });
        }
        // Requirement-announcer opener: a paragraph that begins by nominalizing the
        // prior move (abstract/deverbal subject) and announcing what the argument
        // "needs"/"requires". Deletable throat-clearing — the real topic sentence is
        // the concrete one beneath it. (composition-style §Topic Sentences That
        // Announce a Requirement.) Narrow: subject-shape AND requirement-verb both
        // required in the first clause, so it won't fire on ordinary sentences.
        if (sentences.length > 0) {
            const head0 = sentences[0].split(/\s+/).slice(0, 12).join(" ");
            const reqRe = /^(?:[A-Z][a-z]+ing|[A-Z][a-z]+(?:ment|tion|sion|ity|ance|ence|ure))\b[^.;,]{0,40}?\b(needs?|requires?|demands?|calls\s+for|depends\s+on|wants?|must\s+have)\b/;
            const rm = head0.match(reqRe);
            if (rm) {
                violations.push({
                    rule: "requirement_announcer",
                    paragraph: pNum,
                    sentence: 1,
                    snippet: sentences[0].slice(0, 140),
                    note: `opener pairs an abstract/deverbal subject with a requirement verb ("${rm[1]}") — it announces the argument's plumbing rather than claiming on the material. Cut it and lead with the concrete sentence beneath`,
                });
            }
        }
        // Repeated opening words within paragraph
        const seen = new Map();
        openings.forEach(w => {
            if (!w)
                return;
            seen.set(w, (seen.get(w) || 0) + 1);
        });
        const repeats = Array.from(seen.entries()).filter(([, n]) => n > 1);
        if (repeats.length) {
            violations.push({ rule: "repeated_opening_word", paragraph: pNum, snippet: repeats.map(([w, n]) => `${w} (${n}×)`).join(", ") });
        }
        // Generic-noun totem (composition-style §Name the Subject / vary referents).
        // A generic anchor noun — "the word", "a term", "the concept" — repeated as a
        // determined noun-phrase across ≥3 sentences of a paragraph drones without
        // specifying. On lexical/conceptual topics the drafts pile these up ("a word
        // / the word / a term / the lexical item") and pass every other rule clean, so
        // the totem is invisible without its own check. Quote-stripped (quoting a term
        // repeatedly is not the fault); counts DISTINCT sentences; the determiner
        // requirement keeps it off "in other words" / "in terms of".
        // determiner + up to two intervening adjectives ("the failed term", "a
        // contested word") + generic noun. Track distinct sentences AND total
        // count, so a long paragraph (≥3 sentences) and a compressed one (≥4
        // total) both trip.
        // GENERIC totem detection: ANY head noun repeated as a determined NP
        // ("the X", "a contested Y") — not a fixed list — so novel totems ("the
        // carrier", "the apparatus", "the field", "the position") are caught, not
        // just word/term/concept. Quote-stripped; determiner-anchored (keeps it off
        // "in other words"); a head noun is the last word after determiner + up to
        // two adjectives. Advisory by nature: a noun repeated because it is the
        // paragraph's load-bearing technical term is NOT a totem — the swap-for-X
        // test decides, which a regex cannot. "point of view"/"of departure" exempt.
        const TOTEM_STOP = new Set([  // structural/meta nouns that recur legitimately
            "essay", "article", "section", "paragraph", "sentence", "chapter", "page",
            "reader", "writer", "author", "example", "case", "time", "fact", "kind",
            "sort", "part", "above", "below",
        ]);
        const totem = new Map();
        sentences.forEach((s, sIdx) => {
            const txt = stripQuoted(s);
            // determiner + the immediate head noun (≥4 letters). No adjective-skip:
            // a greedy skip eats the noun ("the carrier does the work" → "work"),
            // so we take the first content word after the determiner. Catches the
            // bare-totem shape ("the carrier", "the apparatus", "the field") that is
            // how totems actually appear.
            const re = /\b(?:the|a|an|this|that|these|those|its|their|each|every|such)\s+([a-z]{4,})\b/gi;
            let m;
            while ((m = re.exec(txt)) !== null) {
                const head = m[1].toLowerCase();
                if (/^points?$/.test(head) && /^\s+of\s+(?:view|departure)/i.test(txt.slice(re.lastIndex)))
                    continue;
                const lemma = head.replace(/s$/, "");
                if (TOTEM_STOP.has(lemma)) continue;
                if (!totem.has(lemma))
                    totem.set(lemma, { sents: new Set(), count: 0 });
                const rec = totem.get(lemma);
                rec.sents.add(sIdx);
                rec.count++;
            }
        });
        totem.forEach((rec, lemma) => {
            // 4+ distinct sentences anchored on it, or 5+ uses in close proximity
            if (rec.sents.size >= 4 || rec.count >= 5) {
                violations.push({
                    rule: "noun_totem",
                    paragraph: pNum,
                    snippet: `"the ${lemma}" ×${rec.count} across ${rec.sents.size} sentences`,
                    note: `"${lemma}" repeats as a determined noun ${rec.count}× — if its invocation has replaced specification it is a totem (vary the referring expression so each use specifies a different aspect); if each use genuinely brings a new aspect it is a load-bearing term, disregard via the swap-for-X test`,
                });
            }
        });
        // Gerund-opener drone (composition-style §The Voice / vary the form).
        // A fronted -ing participle ("Sharpening the sense…", "Retiring the
        // word…") is a fine periodic operation, but stacked it becomes a tic the
        // way a repeated opening word does. repeated_opening_word misses it
        // because each gerund is a DIFFERENT word; this catches the repeated FORM.
        const gerundOpeners = openings.filter(isGerundOpener);
        if (gerundOpeners.length >= 3) {
            violations.push({
                rule: "gerund_opener_drone",
                paragraph: pNum,
                snippet: gerundOpeners.slice(0, 5).join(", "),
                note: `${gerundOpeners.length} sentences open on a gerund participle (${gerundOpeners.slice(0, 4).join(", ")}…) — the -ing-fronted operation has become the paragraph's default shape; recast some to lead on the subject/noun so the form varies`,
            });
        }
        // Choppy paragraph (composition-style §The Voice — periodic, developed
        // sentences). Over-compression drops the mean sentence length well below
        // the register's norm (academic prose runs ~22–28 words/sentence); a
        // paragraph averaging under 15 reads as clipped and choppy. Reports the
        // mean so the writer can judge; needs ≥3 sentences to be meaningful.
        if (sentences.length >= 3) {
            const wps = sentences.map((s) => (s.trim().split(/\s+/).filter(Boolean).length));
            const meanWps = wps.reduce((a, b) => a + b, 0) / sentences.length;
            const shortCount = wps.filter((n) => n < 12).length;
            if (meanWps < 15) {
                violations.push({
                    rule: "choppy_paragraph",
                    paragraph: pNum,
                    snippet: `mean ${meanWps.toFixed(1)} words/sentence over ${sentences.length} sentences (${shortCount} under 12)`,
                    note: `the paragraph averages ${meanWps.toFixed(1)} words/sentence — short and choppy for the register; combine clipped sentences and develop the periods so the rhythm carries`,
                });
            }
        }
        // Record cross-paragraph trackers for end-of-loop checks
        if (isGerundOpener(openings[0]))
            paraOpenerGerunds.push({ para: pNum, word: openings[0] });
        if (openings[0])
            paraFirstWords.push({ para: pNum, word: openings[0] });
        paraScholarSubjects.push({ para: pNum, scholar: firstScholarSubject });
    });
    // Cross-paragraph rule: ±2-paragraph first-word repeat (Rule 7)
    for (let i = 0; i < paraFirstWords.length; i++) {
        for (let j = i + 1; j < Math.min(i + 3, paraFirstWords.length); j++) {
            if (paraFirstWords[i].word === paraFirstWords[j].word) {
                violations.push({
                    rule: "cross_paragraph_first_word_repeat",
                    paragraph: paraFirstWords[j].para,
                    snippet: `P${paraFirstWords[i].para} and P${paraFirstWords[j].para} both open on "${paraFirstWords[i].word}"`,
                    note: "No two paragraph openers within ±2 paragraphs may share a first word (Rule 7)",
                });
            }
        }
    }
    // Cross-paragraph gerund-opener drone: ≥3 paragraphs whose first sentence
    // opens on a gerund participle. Each one is fine; the section-wide pattern is
    // the tic — every paragraph led by an -ing operation flattens the rhythm.
    if (paraOpenerGerunds.length >= 3) {
        violations.push({
            rule: "cross_paragraph_gerund_opener",
            paragraph: paraOpenerGerunds[paraOpenerGerunds.length - 1].para,
            snippet: paraOpenerGerunds.map((g) => `P${g.para} "${g.word}"`).join(", "),
            note: `${paraOpenerGerunds.length} paragraphs open on a gerund participle — vary the paragraph-opener form so the -ing operation isn't the section's default shape`,
        });
    }
    // Cross-paragraph rule: scholar-as-grammatical-subject across >3 consecutive paragraphs (Rule 7)
    let run = 0;
    let runScholar = "";
    let runStartPara = 0;
    for (const entry of paraScholarSubjects) {
        if (entry.scholar && entry.scholar === runScholar) {
            run++;
            if (run === 4) {
                violations.push({
                    rule: "cross_paragraph_scholar_subject",
                    paragraph: entry.para,
                    snippet: `"${runScholar}" is the grammatical subject of paragraphs P${runStartPara}–P${entry.para}`,
                    note: `${run} consecutive paragraphs with ${runScholar} as grammatical subject (max 3). Recast openers to lead on the concept/operation/position; fold the scholar in subordinately.`,
                });
            }
        }
        else {
            run = entry.scholar ? 1 : 0;
            runScholar = entry.scholar || "";
            runStartPara = entry.para;
        }
    }
    // Whole-draft rule: noun-phrase totems (Rule 6)
    // Count "the <adj>? <noun>" phrases across the whole draft. Skip common stopwords.
    const npCounts = new Map();
    const npRe = /\bthe\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+)?)\b/g;
    const TOTEM_STOPWORDS = new Set([
        "the same", "the way", "the first", "the second", "the third", "the next",
        "the last", "the only", "the other", "the whole", "the rest", "the most",
        "the more", "the less", "the very", "the kind", "the sort", "the moment",
        "the time", "the case", "the point", "the question", "the answer", "the one",
        "the prose", "the sentence", "the paragraph", "the section", "the essay",
        "the argument", "the claim", "the position", // these themselves are common totems but easy to confuse with real terms
    ]);
    const draftLower = draft.toLowerCase();
    let npMatch;
    while ((npMatch = npRe.exec(draftLower)) !== null) {
        const np = "the " + npMatch[1];
        if (TOTEM_STOPWORDS.has(np))
            continue;
        npCounts.set(np, (npCounts.get(np) || 0) + 1);
    }
    for (const [np, count] of npCounts) {
        if (count >= 4) {
            violations.push({
                rule: "noun_phrase_totem",
                paragraph: 0,
                snippet: `"${np}" appears ${count} times in the draft`,
                note: "Sister failure to parallel-beat: the prose re-names rather than developing. Replace with the noun: if only repetition is lost, it was a totem.",
            });
        }
    }
    // Group by rule for a compact summary
    const summary = {};
    for (const v of violations)
        summary[v.rule] = (summary[v.rule] || 0) + 1;
    // Decide whether to do inline Supabase work this call.
    // Inline work = await OpenAI embedding (1–2s) + Supabase RPC (200–500ms).
    // The audit itself is ~10ms; we don't want to spend ~2s on persistence on
    // every call. Strategy:
    //   - If violations.length === 0 AND attach_corrections is false (or default
    //     when no violations), return the audit IMMEDIATELY and kick off the
    //     persistence as a background promise (fire-and-forget). The scraper
    //     will pick the draft up from mcp.log on its next run anyway.
    //   - If violations.length > 0 AND attach_corrections is true (default),
    //     do the embedding + Supabase work inline because we need the result
    //     for the inline similar_corrections attachment, but bound it by a
    //     hard timeout so it can never hang the audit.
    let historyId = null;
    let similar_corrections: any[] = [];
    const persistInBackground = async () => {
        try {
            const embedding = await getQueryEmbedding(draft.slice(0, 8000));
            await supabase
                .from("drafts_check_history")
                .insert({
                draft_text: draft,
                draft_embedding: embedding,
                violation_count: violations.length,
                violations,
                project_slug: project_slug || null,
                source: "drafts_check_style",
            });
        }
        catch (err) {
            // Silently swallow; the scraper backfills.
        }
    };
    const wantInline = attach_corrections !== false && violations.length > 0;
    if (wantInline) {
        // Race the inline work against a 4-second budget. If we exceed it,
        // fall through with empty similar_corrections rather than hang.
        const inlineWork = (async () => {
            try {
                const embedding = await getQueryEmbedding(draft.slice(0, 8000));
                const insertP = supabase
                    .from("drafts_check_history")
                    .insert({
                    draft_text: draft,
                    draft_embedding: embedding,
                    violation_count: violations.length,
                    violations,
                    project_slug: project_slug || null,
                    source: "drafts_check_style",
                })
                    .select("id")
                    .single();
                const rpcP = supabase.rpc("drafts_similar_corrections", {
                    query_embedding: embedding,
                    match_count: 2,
                });
                const [insertRes, rpcRes] = await Promise.all([insertP, rpcP]);
                if (!insertRes.error && insertRes.data) {
                    historyId = insertRes.data.id;
                }
                if (!rpcRes.error && Array.isArray(rpcRes.data)) {
                    similar_corrections = rpcRes.data.map((row) => ({
                        similarity: row.similarity,
                        rejected: {
                            text: row.rejected_text,
                            violation_count: row.rejected_violation_count,
                            violations: row.rejected_violations,
                        },
                        chosen: {
                            text: row.chosen_text,
                            violation_count: row.chosen_violation_count,
                            violations: row.chosen_violations,
                        },
                    }));
                }
            }
            catch (err) {
                // swallow
            }
        })();
        const timeout = new Promise(resolve => setTimeout(resolve, 4000));
        await Promise.race([inlineWork, timeout]);
    }
    else {
        // Fire-and-forget persistence. Don't block the response.
        persistInBackground();
    }
    return {
        content: [{
                type: "text",
                text: JSON.stringify({
                    success: true,
                    paragraphs: rawParas.length,
                    violation_count: violations.length,
                    summary,
                    violations,
                    history_id: historyId,
                    similar_corrections,
                    persistence: wantInline ? "inline" : "background",
                }, null, 2),
            }],
    };
});
// Companion tool: explicit lookup of past (rejected, chosen) pairs by similarity to a target draft.
// Topic-sentence method (Rule 5) as its own tool — diagnose each paragraph's
// opener and propose move-making rewrites. Diagnosis + Claude rewrites run in the
// Modal projector endpoint (which holds the Claude key); this tool is the client.
const TOPIC_SENTENCE_ENDPOINT = "https://jts3et--nlh-draft-projector-fastapi-app.modal.run/topic_sentences";
server.tool("drafts_topic_sentences", "Audit a draft's TOPIC SENTENCES (paragraph openers) against Justin's Rule-5 method and propose move-making rewrites for the faulty ones. For each paragraph it isolates the opener, judges whether it MAKES A MOVE or ANNOUNCES A POSITION, names the fault (requirement-announcer, source-as-title+function-verb, bland function-verb, negation opener, pure metadiscourse, relative-pronoun opener, free-relative subject), and — for faulty openers — returns a Claude-proposed rewrite that seats the move the paragraph's body actually makes. Use when revising paragraph openings or auditing a section's topic sentences; complements drafts_check_style (which audits whole paragraphs). Calls the Modal projector (Claude rewrites), so allow ~10–30s.", {
    draft: z.string().describe("The draft text (markdown or plain) whose paragraph openers to audit."),
}, async ({ draft }) => {
    try {
        const r = await fetch(TOPIC_SENTENCE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: draft }),
        });
        const data = await r.json();
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});
// Revision tool — turns the journal-fit diagnosis into a LOCATED, prioritized
// worklist anchored to the draft's real paragraphs, plus bounded edge rewrites
// (opener/close), a timeliness reframe, an optional target-essay reshape guide,
// and (opt-in) flagged "re-compose-from-source" body suggestions. Diagnosis +
// Claude synthesis run in the Modal projector; this tool is the client.
const REVISE_ENDPOINT = "https://jts3et--nlh-draft-projector-fastapi-app.modal.run/revise";
server.tool("drafts_revision_plan", "Build a LOCATED revision plan for moving a draft toward a target journal's patterns (themes + rhetorical move-structure). Anchors the move-arc to the draft's actual paragraphs and returns: a prioritized worklist (which over-indexed moves to thin at which ¶, how to convert the opener/close, which corpus-common moves to add where, how to shift the frame toward a rising register), bounded rewrites of the opener and closing sentence, a timeliness note, and — when target_fn is given — a reshape guide toward that NLH essay's arc. Set body=true to also get flagged re-compose-from-source suggestions for the worklist's paragraphs (NOT committed prose — Justin's method requires composing from a whole reading of the source). Body prose otherwise stays the author's. Calls the Modal projector (Claude), ~20–60s (longer with body).", {
    draft: z.string().describe("The draft text (markdown or plain) to plan a revision for."),
    journal: z.string().optional().default("NLH").describe("Target journal id (default NLH)."),
    target_fn: z.string().optional().describe("Optional file_name of a structural-sibling essay to reshape toward (from the nearest-by-structure list)."),
    body: z.boolean().optional().default(false).describe("If true, also return flagged re-compose-from-source suggestions for the worklist's paragraphs."),
}, async ({ draft, journal, target_fn, body }) => {
    try {
        const r = await fetch(REVISE_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: draft, journal: journal || "NLH", target_fn, body: !!body }),
        });
        const data = await r.json();
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});
server.tool("drafts_get_similar_corrections", "Find past draft pairs from drafts_check_history where the rejected version had similar prose to the input and the chosen version reduced violations. Use to learn from past corrections when composing or revising. Embeds the input via OpenAI text-embedding-3-small and runs cosine similarity against rows where revised_to_id is set.", {
    draft_text: z.string().describe("The draft text to find similar past corrections for."),
    k: z.number().optional().default(3).describe("Number of correction pairs to return (default 3)."),
}, async ({ draft_text, k }) => {
    try {
        const embedding = await getQueryEmbedding(draft_text.slice(0, 8000));
        const { data, error } = await supabase.rpc("drafts_similar_corrections", {
            query_embedding: embedding,
            match_count: k || 3,
        });
        if (error)
            throw error;
        const corrections = (data || []).map((row) => ({
            similarity: row.similarity,
            rejected: {
                id: row.rejected_id,
                text: row.rejected_text,
                violation_count: row.rejected_violation_count,
                violations: row.rejected_violations,
            },
            chosen: {
                id: row.chosen_id,
                text: row.chosen_text,
                violation_count: row.chosen_violation_count,
                violations: row.chosen_violations,
            },
        }));
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        count: corrections.length,
                        corrections,
                    }, null, 2),
                }],
        };
    }
    catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: _errStr(err) }) }] };
    }
});
// On-demand pattern miner: runs the Python miner script and returns the markdown report.
server.tool("drafts_mine_patterns", "Run the style-pattern miner over the recent drafts_check_history dataset and return the markdown report. Surfaces: (1) violation-frequency histogram, (2) rule-resolution rates (which rules the chat-Claude is actually fixing vs. ignoring), (3) per-rule worked examples of what corrections look like, (4) 'suspect pairs' where the model rewrote heavily but few rules flagged — candidates for new rules or §The Voice exemplars, (5) drift signal (recent week vs. prior). Use when starting a revision-heavy session, when auditing whether the skill rules are landing, or when looking for new rule candidates.", {
    refresh: z.boolean().optional().default(true).describe("If true (default), re-run the miner before returning. If false, return the cached report file."),
}, async ({ refresh }) => {
    try {
        const { exec } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execP = promisify(exec);
        if (refresh !== false) {
            // Re-scrape the mcp.log into fresh pairs.jsonl (with Supabase sync on so
            // revised_to_id links backfill), THEN mine. Previously this only ran the
            // miner over a stale pairs.jsonl, so refresh did nothing.
            await execP('SCRAPER_SYNC_SUPABASE=1 python3 "/Users/justin/Folders for Claude Coworker/scripts/style_preference_scraper.py"', { timeout: 120000 }).catch(() => {});
            await execP('python3 "/Users/justin/Folders for Claude Coworker/scripts/style_pattern_miner.py"', { timeout: 60000 });
        }
        const { readFile } = await import("node:fs/promises");
        const reportPath = "/Users/justin/Folders for Claude Coworker/scripts/style_preference_data/rule_candidates.md";
        const report = await readFile(reportPath, "utf-8");
        return {
            content: [{
                    type: "text",
                    text: report,
                }],
        };
    }
    catch (err) {
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ error: _errStr(err) }),
                }],
        };
    }
});

// ===== Target-journal projector tools (theme + move models via the Modal endpoint) =====
const TJ_ENDPOINT = "https://jts3et--nlh-draft-projector-fastapi-app.modal.run";
const _tjText = async (text?: string, path?: string): Promise<string> => {
    if (text && text.trim()) return text;
    if (path) {
        const fs = await import("node:fs/promises");
        return (await fs.readFile(path, "utf8")).split(/^#\s*Notes\b/m)[0];
    }
    throw new Error("Provide `text` or `path`.");
};
const _tjPost = async (ep: string, body: unknown): Promise<unknown> => {
    const r = await fetch(TJ_ENDPOINT + ep, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`projector ${ep} HTTP ${r.status}`);
    return await r.json();
};
// Compact digests — raw JSON.stringify of projector responses truncates in MCP transport.
const _tjFmtAnalyze = (d: any): string => {
    if (d.error) return "Error: " + d.error;
    const L: string[] = [`THEME + RHETORIC — ${d.journal_label || d.journal} (${d.words} words)`];
    const th = d.theme || {};
    if (th.top_atoms?.length) L.push("Theme atoms: " + th.top_atoms.map((a: any) => `${a.name} ${a.pct}%`).join(", "));
    if (th.siblings?.length) L.push("Nearest by theme: " + th.siblings.map((s: any) => `${s.title} (${s.sim})`).join("; "));
    if (d.theme_error) L.push("theme_error: " + d.theme_error);
    const rh = d.rhetoric || {};
    if (rh.n_moves) L.push(`\nRhetoric: ${rh.n_moves} moves`);
    const dv = rh.divergence || {};
    if (dv.opens) L.push(`Opens: ${dv.opens} (corpus: ${dv.corpus_opens}) | Closes: ${dv.closes} (corpus: ${dv.corpus_closes})`);
    if (dv.missing?.length) L.push("Missing corpus moves: " + dv.missing.join("; "));
    if (rh.profile?.length) L.push("Move profile vs corpus: " + rh.profile.slice(0, 6).map((p: any) => `${p.name} ${p.pct}% (corpus ${p.corpus}%)`).join("; "));
    if (rh.nearest?.length) L.push("Nearest by structure: " + rh.nearest.map((s: any) => `${s.title} (${s.sim})`).join("; "));
    if (d.rhetoric_error) L.push("rhetoric_error: " + d.rhetoric_error);
    return L.join("\n");
};
const _tjFmtSeq = (d: any): string => {
    if (d.error) return "Error: " + d.error;
    const ps = d.paragraphs || [];
    const free = ps.filter((p: any) => p.out === 0);
    const hubs = [...ps].sort((a: any, b: any) => b.out - a.out).slice(0, 4);
    const L: string[] = [`DEPENDENCY MAP — ${d.n} paragraphs · ${(d.edges || []).length} deps · ${(d.cycles || []).length} cycles · ${(d.violations || []).length} used-before-defined · ${free.length} free joints`];
    L.push("Spine (hubs): " + hubs.map((p: any) => `¶${p.id} (out=${p.out}) ${(p.label || "").slice(0, 40)}`).join(" | "));
    L.push("Free joints (movable): " + free.map((p: any) => `¶${p.id}${p.win ? ` [ranks ${p.win[0] + 1}-${p.win[1] + 1}]` : ""}`).join(", "));
    if ((d.cycles || []).length) L.push("CYCLES: " + d.cycles.map((c: any) => "{" + c.map((x: any) => "¶" + x).join(" ") + "}").join(" "));
    if ((d.violations || []).length) L.push("Used-before-defined: " + d.violations.map((v: any) => `¶${v[0]}<-¶${v[1]}`).join(", "));
    const orph = Object.keys(d.orphans || {});
    if (orph.length) L.push("Orphan terms in: " + orph.map(i => "¶" + i).join(", "));
    return L.join("\n");
};
const _tjFmtRevise = (d: any): string => {
    if (d.error) return "Error: " + d.error;
    const p = d.plan || {};
    const L: string[] = [`REVISION PLAN — ${d.journal || "?"} (${d.n_moves} moves, ${d.n_paragraphs} paras)`];
    const dv = d.divergence || {};
    if (dv.opens) L.push(`Opens: ${dv.opens} (corpus: ${dv.corpus_opens}) | Closes: ${dv.closes} (corpus: ${dv.corpus_closes})`);
    if (dv.missing?.length) L.push("Missing corpus moves: " + dv.missing.join("; "));
    (d.over_indexed || []).slice(0, 6).forEach((o: any) => L.push(`Over-indexed: ${o.atom} ${o.pct}% vs corpus ${o.corpus}% (¶${o.paras})`));
    if (p.raw) { L.push("\n[plan returned as raw text — model JSON didn't fully parse]\n" + p.raw); return L.join("\n"); }
    if (p.worklist?.length) { L.push("\nWorklist:"); p.worklist.forEach((w: any) => L.push(`  [${w.priority || ""}] ¶${w.paragraph ?? "-"}: ${w.issue || ""} -> ${w.action || ""}`)); }
    if (p.opener_rewrite) L.push("\nOPENER REWRITE: " + p.opener_rewrite);
    if (p.close_rewrite) L.push("\nCLOSE REWRITE: " + p.close_rewrite);
    if (p.timeliness) L.push("\nTimeliness: " + p.timeliness);
    if (d.body_suggestions?.length) L.push(`\n(+${d.body_suggestions.length} body-paragraph suggestions; re-run with body=true)`);
    return L.join("\n");
};

server.tool("journal_list_models", "List the trained target-journal models available for projection (NLH, ELH, Inquiry). Each is trained on that journal's published corpus: theme discourse-atoms + rhetorical move-atoms.", {}, async () => {
    try {
        const d: any = await (await fetch(TJ_ENDPOINT + "/journals")).json();
        return { content: [{ type: "text", text: JSON.stringify(d.journals || d, null, 2) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});

server.tool("journal_project_draft", "Project a draft onto a target journal's trained model. Returns THEME fit (which discourse-atoms the draft loads on + nearest published essays by theme = cite-neighborhood) and the RHETORICAL move-arc (ordered move-atoms, profile vs corpus, opens/closes divergence, nearest essays by structure). (~25-40s)", {
    text: z.string().optional().describe("The draft text (>=50 words). Provide this OR path."),
    path: z.string().optional().describe("Server-side path to a draft file (local-only; use text remotely)."),
    journal: z.string().default("Inquiry").describe("Target journal id (NLH | ELH | Inquiry)"),
}, async ({ text, path, journal }) => {
    try {
        const d = await _tjPost("/analyze", { text: await _tjText(text, path), journal });
        return { content: [{ type: "text", text: _tjFmtAnalyze(d) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});

server.tool("journal_dependency_map", "Map a draft's LOGICAL paragraph-dependency structure (journal-independent): spine (hub paragraphs many depend on), free joints (paragraphs nothing depends on = movable), cycles (mutual presupposition = defects), used-before-defined violations, per-paragraph feasible position windows. (~40-100s)", {
    text: z.string().optional().describe("The draft text (>=50 words). Provide this OR path."),
    path: z.string().optional().describe("Server-side path to a draft file (local-only)."),
}, async ({ text, path }) => {
    try {
        const d = await _tjPost("/sequence", { text: await _tjText(text, path) });
        return { content: [{ type: "text", text: _tjFmtSeq(d) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});

server.tool("journal_revision_plan", "Build a revision plan reshaping a draft toward a target journal: paragraph worklist (priority/issue/action), over-indexed and corpus-common-but-missing moves, opener/close rewrites, optional body re-compose suggestions. (~60-120s; may exceed short MCP client timeouts.)", {
    text: z.string().optional().describe("The draft text (>=50 words). Provide this OR path."),
    path: z.string().optional().describe("Server-side path to a draft file (local-only)."),
    journal: z.string().default("Inquiry").describe("Target journal id"),
    target_fn: z.string().optional().describe("Optional file_name of a corpus essay to reshape toward."),
    body: z.boolean().default(false).describe("Include body-paragraph rewrite suggestions (slower)."),
}, async ({ text, path, journal, target_fn, body }) => {
    try {
        const d = await _tjPost("/revise", { text: await _tjText(text, path), journal, target_fn, body });
        return { content: [{ type: "text", text: _tjFmtRevise(d) }] };
    } catch (err) {
        return { content: [{ type: "text", text: JSON.stringify({ error: String(err) }) }] };
    }
});

    return server;
}
