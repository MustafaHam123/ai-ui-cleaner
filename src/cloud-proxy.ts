import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";

export async function createCloudProxy(origin: string, readToken = "") {
  const url = new URL(origin);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Cloud MCP requires HTTPS except for loopback development");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Use a bare Worker origin for AI_UI_CLEANER_CLOUD_URL");
  url.pathname = "/mcp";
  const upstream = new Client({ name: "ai-ui-cleaner-cloud-proxy", version: "0.1.2" });
  await upstream.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: readToken ? { authorization: `Bearer ${readToken}` } : {}, redirect: "error" } }));
  const server = new Server(upstream.getServerVersion() ?? { name: "ai_ui_cleaner", version: "0.1.2" }, {
    capabilities: { tools: {} }, instructions: upstream.getInstructions(),
  });
  server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
  server.setRequestHandler(CallToolRequestSchema, request => upstream.callTool(request.params));
  server.onclose = () => { void upstream.close(); };
  return server;
}
