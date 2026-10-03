import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createUiFixerServer } from "../src/server.js";
import { ReferenceStore } from "../src/store.js";

test("MCP server exposes the retrieval workflow and returns structured results", async () => {
  const store = new ReferenceStore([new URL("../data/references.jsonl", import.meta.url).pathname]);
  await store.initialize();
  const server = createUiFixerServer(store);
  const client = new Client({ name: "ui-fixer-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const tools = await client.listTools();
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      ["get_code_asset", "get_reference", "reference_stats", "search_references"],
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
