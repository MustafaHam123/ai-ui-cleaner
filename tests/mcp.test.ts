import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAiUiCleanerServer } from "../src/server.js";
import { ReferenceStore } from "../src/store.js";

test("MCP server exposes the retrieval workflow and returns structured results", async () => {
  const store = new ReferenceStore([new URL("../data/references.jsonl", import.meta.url).pathname]);
  await store.initialize();
  const server = createAiUiCleanerServer(store);
  const client = new Client({ name: "ai-ui-cleaner-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["get_code_asset", "get_reference", "get_reference_asset", "reference_stats", "search_references"],
    );

    const response = await client.callTool({
      name: "search_references",
      arguments: { query: "technical AI research workspace with visible sources", limit: 3 },
    });
    assert.equal(response.isError, undefined);
    const structured = response.structuredContent as { count: number; results: Array<{ id: string }> };
    assert.ok(structured.count > 0);
    assert.equal(structured.results[0].id, "pattern-ai-workbench-01");
  } finally {
    await client.close();
    await server.close();
  }
});
