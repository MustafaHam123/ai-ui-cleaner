import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadLocalEnvironment } from "../src/load-env.js";
loadLocalEnvironment();
const local = process.argv.includes("--local");
const base = local ? "http://127.0.0.1:8787" : process.env.AI_UI_CLEANER_CLOUD_URL;
const token = local ? "local-development-reader" : process.env.MCP_READ_TOKEN;
if (!base) throw new Error("Configure the cloud origin, or use --local with the emulator");
const origin = new URL(base);
if (origin.protocol !== "https:" && !local) throw new Error("Use HTTPS for cloud verification");
if (origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) throw new Error("Use a bare Worker origin");
const client = new Client({ name: "ai-ui-cleaner-smoke", version: "0.1.0" });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", origin), { requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {}, redirect: "error" } }));
  const stats = await client.callTool({ name: "reference_stats", arguments: {} });
  if (stats.isError) throw new Error("Corpus stats unavailable");
  console.log("Corpus:", JSON.stringify(stats.structuredContent));
  const search = await client.callTool({ name: "search_references", arguments: { query: "draggable before after image comparison", limit: 3 } });
  const data = search.structuredContent as { results: Array<{ id: string }> };
  if (search.isError || !data.results.length) throw new Error("Initial-corpus search returned no references");
  console.log("Search hits:", data.results.map(r => r.id).join(", "));
  const preview = await client.callTool({ name: "get_reference_asset", arguments: { referenceId: "recent-ex3s3bx", assetId: "recent-ex3s3bx-preview" } });
  if (preview.isError || !(preview.content as Array<{ type: string }>).some(c => c.type === "image")) throw new Error("Initial-corpus preview failed");
  console.log("R2 preview:", JSON.stringify(preview.structuredContent));
  const code = await client.callTool({ name: "get_code_asset", arguments: { id: "shadcn-tabs" } });
  console.log("Licensed tabs code:", code.isError ? "still gated pending explicit review" : "available after explicit review");
} finally { await client.close(); }
