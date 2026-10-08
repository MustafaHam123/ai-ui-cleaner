import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAiUiCleanerServer } from "../src/server.js";
import { ReferenceStore } from "../src/store.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseReferenceRecord } from "../src/schema.js";
import type { ReferenceRepository } from "../src/repository.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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

test("screenshot delivery includes actual image bytes separately from metadata", async t => {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const seed = JSON.parse((await readFile(new URL("../data/references.jsonl", import.meta.url), "utf8")).trim().split("\n")[0]);
  const record = parseReferenceRecord({ ...seed, id: "image-delivery-fixture", assets: [{
    id: "fixture-png", kind: "screenshot", storageKey: "assets/test/frame.png", mediaType: "image/png",
    alt: "A one pixel PNG transport fixture", sha256: digest, width: 1, height: 1,
  }] });
  const store: ReferenceRepository = {
    get: async id => id === record.id ? record : undefined,
    search: async () => [],
    stats: async () => ({ total: 1, sources: {}, kinds: {}, reusableCodeAssets: 0, visualAssets: 1, backend: "test" }),
  };
  let returnedBytes = new Uint8Array(bytes);
  let returnedMediaType = "image/png";
  let reads = 0;
  const server = createAiUiCleanerServer(store, { maxAssetBytes: 1024, assetUrl: (ref, asset) => `https://corpus.test/reference-image?referenceId=${ref}&assetId=${asset}`, readAsset: async () => {
    reads++; return { bytes: returnedBytes, mediaType: returnedMediaType };
  } });
  const client = new Client({ name: "image-delivery-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
  const request = async () => await client.callTool({ name: "get_reference_asset", arguments: { referenceId: record.id, assetId: "fixture-png" } }) as CallToolResult;
  try {
    await t.test("the client receives valid pixels and an explicit display contract", async () => {
      const result = await request();
      assert.equal(result.isError, undefined);
      const image = result.content[1];
      assert.equal(image.type, "image");
      if (image.type !== "image") throw new Error("Missing image block");
      assert.equal(image.mimeType, "image/png");
      assert.deepEqual(Buffer.from(image.data, "base64"), bytes);
      assert.equal(result.structuredContent, undefined, "Codex clients must not prefer structured metadata over image content");
      const text = result.content[0];
      assert.equal(text.type, "text");
      if (text.type !== "text") throw new Error("Missing text metadata");
      const metadata = JSON.parse(text.text);
      assert.equal(metadata.sha256, digest);
      assert.equal(metadata.imageDelivery.location, "content[1]");
      assert.equal(metadata.imageDelivery.requiresVisualInspection, true);
      assert.equal(metadata.screenshotUrl, "https://corpus.test/reference-image?referenceId=image-delivery-fixture&assetId=fixture-png");
      assert.ok(!JSON.stringify(metadata).includes(image.data), "Do not duplicate base64 into metadata");
      // Model a client that picks structuredContent when present: pixels must survive.
      const preferred = result.structuredContent ?? result.content;
      assert.ok(Array.isArray(preferred) && preferred.some(block => block.type === "image"));
      const detail = await client.callTool({ name: "get_reference", arguments: { id: record.id } });
      assert.deepEqual((detail.structuredContent as { screenshotUrls: unknown }).screenshotUrls, [{ assetId: "fixture-png", url: metadata.screenshotUrl }]);
    });
    await t.test("bad MIME, signature, digest and oversized bytes never return a screenshot", async () => {
      for (const variant of [
        { bytes: new Uint8Array(bytes), mediaType: "image/jpeg" },
        { bytes: new TextEncoder().encode("not an image"), mediaType: "image/png" },
        { bytes: new Uint8Array([...bytes, 0]), mediaType: "image/png" },
        { bytes: new Uint8Array(1025), mediaType: "image/png" },
      ]) {
        returnedBytes = variant.bytes; returnedMediaType = variant.mediaType;
        const result = await request();
        assert.equal(result.isError, true);
        assert.ok(!result.content.some(block => block.type === "image"));
      }
    });
    await t.test("unknown reference or asset cannot read object storage", async () => {
      const before = reads;
      for (const args of [
        { referenceId: "unknown-reference", assetId: "fixture-png" },
        { referenceId: record.id, assetId: "unknown-asset" },
      ]) assert.equal((await client.callTool({ name: "get_reference_asset", arguments: args })).isError, true);
      assert.equal(reads, before);
    });
  } finally { await client.close(); await server.close(); }
});
