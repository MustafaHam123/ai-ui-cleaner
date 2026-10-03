import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { createUiFixerServer } from "./server.js";
import { ReferenceStore } from "./store.js";

async function runStdio(store: ReferenceStore): Promise<void> {
  const server = createUiFixerServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`ui_fixer MCP ready over stdio with ${(await store.all()).length} references`);
}

async function runHttp(store: ReferenceStore): Promise<void> {
  const host = process.env.MCP_HOST ?? "127.0.0.1";
  const allowedHosts = process.env.MCP_ALLOWED_HOSTS?.split(",").map((value) => value.trim()).filter(Boolean);
  const app = createMcpExpressApp({ host, allowedHosts });
  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  app.get("/health", async (_request, response) => {
    response.json({ ok: true, references: (await store.all()).length });
  });

  app.post("/mcp", async (request, response) => {
    const server = createUiFixerServer(store);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    response.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
    } catch (error) {
      console.error("MCP request failed", error);
      if (!response.headersSent) {
        response.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  const rejectUnsupported = (_request: unknown, response: { status: (code: number) => { json: (body: unknown) => void } }) => {
    response.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed for stateless transport." },
      id: null,
    });
  };
  app.get("/mcp", rejectUnsupported);
  app.delete("/mcp", rejectUnsupported);

  app.listen(port, host, () => {
    console.error(`ui_fixer MCP listening at http://${host}:${port}/mcp`);
  });
}

async function main(): Promise<void> {
  const store = new ReferenceStore();
  await store.initialize();

  if ((process.env.MCP_TRANSPORT ?? "stdio") === "http") {
    await runHttp(store);
  } else {
    await runStdio(store);
  }
}

void main().catch((error) => {
  console.error("ui_fixer failed to start", error);
  process.exit(1);
});
