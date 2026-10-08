import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from "miniflare";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCloudProxy } from "../../src/cloud-proxy.js";
import { CloudflareStore, makeChunks, type Env } from "../../cloudflare/store.js";
import { describeTarget } from "../../scripts/collect.js";
import { targets } from "../../scripts/corpus-manifest.js";
import { sourceImageReference } from "../../src/image-metadata.js";
import { createHash } from "node:crypto";

test("Worker stores real D1/R2 data and exposes authenticated stateless MCP", async t => {
  const bundle = await build({ entryPoints: ["cloudflare/worker.ts"], bundle: true, write: false, format: "esm", platform: "neutral", conditions: ["workerd"], mainFields: ["module", "main"], target: "es2022" });
  const mf = new Miniflare(convertV4MiniflareOptions({ script: bundle.outputFiles[0].text, modules: true, compatibilityDate: "2026-10-04", compatibilityFlags: ["nodejs_compat"], d1Databases: { DB: "test-corpus" }, r2Buckets: ["ASSETS"], bindings: { ADMIN_TOKEN: "test-admin", MCP_READ_TOKEN: "test-read" }, log: new Log(LogLevel.NONE) }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database("DB");
  const sql = await readFile("cloudflare/migrations/0001_corpus.sql", "utf8");
  await t.test("public Worker supports anonymous tool calls with real rate limiting and private admin", async () => {
    const publicWorker = new Miniflare(convertV4MiniflareOptions({ script: bundle.outputFiles[0].text, modules: true, compatibilityDate: "2026-10-04", compatibilityFlags: ["nodejs_compat"], d1Databases: { DB: "public-corpus" }, r2Buckets: ["ASSETS"], bindings: { PUBLIC_MCP: "true", ADMIN_TOKEN: "owner-only" }, ratelimits: { MCP_RATE_LIMIT: { namespace_id: "810274", simple: { limit: 120, period: 60 } } }, log: new Log(LogLevel.NONE) }));
    try {
      const publicDb = await publicWorker.getD1Database("DB");
      for (const statement of sql.trim().split(/(?=^CREATE|^PRAGMA)/m).map(s => s.trim()).filter(Boolean)) await publicDb.prepare(statement).run();
      const client = new Client({ name: "anonymous", version: "1" });
      const publicFetch: typeof fetch = async (input, init) => {
        const req = new Request(input, init);
        const response = await publicWorker.dispatchFetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: req.body ? new Uint8Array(await req.arrayBuffer()) : undefined });
        return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
      };
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL("https://public.test/mcp"), { fetch: publicFetch }));
        assert.equal((await client.listTools()).tools.length, 5);
        const stats = await client.callTool({ name: "reference_stats", arguments: {} });
        assert.equal((stats.structuredContent as { total: number }).total, 0);
        assert.equal((await publicWorker.dispatchFetch("https://public.test/admin/stats")).status, 401);
      } finally { await client.close(); }
    } finally { await publicWorker.dispose(); }
  });
  for (const statement of sql.trim().split(/(?=^CREATE|^PRAGMA)/m).map(s => s.trim()).filter(Boolean)) await db.prepare(statement).run();
  const request = (pathname: string, body?: unknown, auth = "test-admin") => mf.dispatchFetch(`https://corpus.test${pathname}`, { method: body === undefined ? "GET" : "POST", headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const record = describeTarget(targets[0], "**License:** MIT", new Date().toISOString());
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lsEAAAAASUVORK5CYII=", "base64");
  record.assets.push({ id: "sample-preview", kind: "screenshot", storageKey: "assets/test.png", mediaType: "image/png", alt: "Original one-pixel test image" });
  record.code = { content: "export const reviewedControl = 'reference';", language: "typescript", dependencies: [], reviewStatus: "reviewed" };
  record.license.reuseAllowed = true;

  await t.test("authentication and size limits fail closed", async () => {
    assert.equal((await request("/admin/stats", undefined, "wrong")).status, 401);
    assert.equal((await request("/mcp", {}, "wrong")).status, 401);
    assert.equal((await request("/admin/ingest", { title: "Missing fields" })).status, 400);
    assert.equal((await mf.dispatchFetch("https://corpus.test/admin/ingest", { method: "POST", headers: { authorization: "Bearer test-admin" }, body: "x".repeat(512_001) })).status, 413);
    assert.equal((await mf.dispatchFetch("https://corpus.test/admin/asset?key=assets/../outside", { method: "PUT", headers: { authorization: "Bearer test-admin" }, body: png })).status, 400);
  });
  await t.test("idempotent imports require explicit preservation of curator review", async () => {
    assert.equal((await request("/admin/ingest", { record })).status, 200);
    assert.equal((await request("/admin/ingest", { record })).status, 200);
    const store = new CloudflareStore({ DB: db as unknown as Env["DB"], ASSETS: {} as Env["ASSETS"] });
    assert.equal((await store.get(record.id))?.code?.reviewStatus, "unreviewed");
    assert.equal((await store.stats()).total, 1);
    const count = await db.prepare("SELECT count(*) n FROM reference_chunks").first<number>("n");
    assert.equal(count, (await makeChunks({ ...record, code: { ...record.code!, reviewStatus: "unreviewed" } })).length);
    assert.equal((await store.search({ query: "draggable compare aligned images", sources: ["21ST.DEV"], components: ["image-compare"] }))[0].record.id, record.id);
    assert.equal((await store.search({ query: "compare images", sources: ["Figma"] })).length, 0);
  });
  const upload = await mf.dispatchFetch("https://corpus.test/admin/asset?key=assets/test.png", { method: "PUT", headers: { authorization: "Bearer test-admin", "content-type": "image/png" }, body: png });
  assert.equal(upload.status, 200);
  const cloudFetch: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    const response = await mf.dispatchFetch(req.url, { method: req.method, headers: Object.fromEntries(req.headers), body: req.body ? new Uint8Array(await req.arrayBuffer()) : undefined });
    return new Response(await response.arrayBuffer(), { status: response.status, headers: Object.fromEntries(response.headers) });
  };
  const client = new Client({ name: "cloud-test", version: "1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL("https://corpus.test/mcp"), { requestInit: { headers: { authorization: "Bearer test-read" } }, fetch: cloudFetch }));
  t.after(() => client.close());
  await t.test("MCP returns records, streamed images, and gated code", async () => {
    assert.equal((await client.listTools()).tools.length, 5);
    const result = await client.callTool({ name: "search_references", arguments: { query: "before after image comparison", limit: 3 } });
    const data = result.structuredContent as { results: Array<Record<string, unknown>> };
    assert.equal(data.results[0].id, record.id);
    assert.equal(data.results[0].code, undefined);
    assert.ok(data.results[0].implementation);
    const asset = await client.callTool({ name: "get_reference_asset", arguments: { referenceId: record.id, assetId: "sample-preview" } });
    assert.equal(asset.isError, undefined);
    const image = (asset.content as Array<{ type: string; data?: string }>).find(c => c.type === "image");
    assert.equal(image?.data, png.toString("base64"));
    assert.equal((await client.callTool({ name: "get_code_asset", arguments: { id: record.id } })).isError, true);
    assert.equal((await request("/admin/ingest", { record, preserveReviewStatus: true })).status, 200);
    assert.equal((await client.callTool({ name: "get_code_asset", arguments: { id: record.id } })).isError, undefined);
  });
  await t.test("semantic outages retain usable keyword retrieval", async () => {
    const store = new CloudflareStore({ DB: db as unknown as Env["DB"], ASSETS: {} as Env["ASSETS"], AI: { run: async () => { throw new Error("test outage"); } } as unknown as Env["AI"], VECTORS: {} as Env["VECTORS"] });
    const hits = await store.search({ query: "image comparison" });
    assert.equal(hits[0].record.id, record.id);
    assert.ok(hits[0].reasons.some(r => r.includes("fallback")));
  });
  await t.test("generic boilerplate and CSS tokens cannot supply keyword evidence alone", async () => {
    const store = new CloudflareStore({ DB: db as unknown as Env["DB"], ASSETS: {} as Env["ASSETS"] });
    assert.equal((await store.search({ query: "reduced motion" })).length, 0);
    // The current record's general accessibility paragraph mentions reduced
    // motion, but its actual subject is image comparison, not animation.
  });
  await t.test("semantic retrieval joins only current, indexed D1 chunks", async () => {
    const chunk = (await makeChunks(record))[0];
    await db.prepare("UPDATE reference_chunks SET vector_indexed=1 WHERE id=?").bind(chunk.id).run();
    const store = new CloudflareStore({ DB: db as unknown as Env["DB"], ASSETS: {} as Env["ASSETS"],
      AI: { run: async () => ({ data: [Array(768).fill(0)] }) } as unknown as Env["AI"],
      VECTORS: { query: async () => ({ matches: [{ id: "stale-not-in-d1", score: .99 }, { id: chunk.id, score: .9 }] }) } as unknown as Env["VECTORS"],
    });
    const hits = await store.search({ query: "unseenquerywordxyz" });
    assert.equal(hits.length, 1); assert.equal(hits[0].record.id, record.id);
    assert.ok(hits[0].reasons.includes("Vectorize semantic match"));
    assert.equal((await store.search({ query: "unseenquerywordxyz", sources: ["Figma"] })).length, 0);
  });
  await t.test("stdio proxy forwards the identical remote tools and corpus", async () => {
    const nativeFetch = globalThis.fetch; globalThis.fetch = cloudFetch;
    try {
      const proxy = await createCloudProxy("https://corpus.test", "test-read");
      const localClient = new Client({ name: "proxy-test", version: "1.0" });
      const [a, b] = InMemoryTransport.createLinkedPair();
      await Promise.all([localClient.connect(a), proxy.connect(b)]);
      try {
        assert.deepEqual(localClient.getServerVersion(), client.getServerVersion());
        assert.equal(localClient.getInstructions(), client.getInstructions());
        assert.equal((await localClient.listTools()).tools.length, 5);
        const stats = await localClient.callTool({ name: "reference_stats", arguments: {} });
        assert.equal((stats.structuredContent as { total: number }).total, 1);
      } finally { await localClient.close(); await proxy.close(); }
    } finally { globalThis.fetch = nativeFetch; }
  });
  await t.test("owner can ingest source-only keyword references without consuming AI quota", async () => {
    const sourceRecord = sourceImageReference({ sha256: createHash("sha256").update(png).digest("hex"), mediaType: "image/png",
      sourceImageUrl: "https://cdn.dribbble.com/userupload/1/file/example.png", sourceUrl: "https://dribbble.com/shots/123-Route-map",
      sourceTitle: "Dispatch route map", sourceDescription: "logistics delivery dispatch route sidebar", storageKey: "assets/test.png", localPath: "unused", bytes: png.length })!;
    const response = await request("/admin/ingest", { record: sourceRecord, indexSemantic: false });
    assert.equal(response.status, 200);
    assert.equal((await response.json() as { semanticIndexed: boolean }).semanticIndexed, false);
    const search = await client.callTool({ name: "search_references", arguments: { query: "dispatch route map", limit: 3 } });
    const hits = (search.structuredContent as { results: Array<{ id: string; sourceMetadata?: { reviewStatus: string } }> }).results;
    assert.equal(hits[0].id, sourceRecord.id);
    assert.equal(hits[0].sourceMetadata?.reviewStatus, "source-text-only");
    const asset = await client.callTool({ name: "get_reference_asset", arguments: { referenceId: sourceRecord.id, assetId: sourceRecord.assets[0].id } });
    assert.equal(asset.isError, undefined);
    const store = new CloudflareStore({ DB: db as unknown as Env["DB"], ASSETS: {} as Env["ASSETS"], AI: { run: async () => { throw new Error("Should not call AI"); } } as unknown as Env["AI"], VECTORS: {} as Env["VECTORS"] });
    assert.equal((await store.upsert(sourceRecord, false)).semanticIndexed, false);
    const quarantine = await request("/admin/exclude", { id: sourceRecord.id });
    assert.equal(quarantine.status, 200);
    assert.equal((await quarantine.json() as { excluded: boolean }).excluded, true);
    assert.equal(await store.get(sourceRecord.id), undefined);
    const hidden = await store.search({ query: "dispatch route map" });
    assert.ok(!hidden.some(hit => hit.record.id === sourceRecord.id));
    const retained = await db.prepare("SELECT record_json FROM ui_references WHERE id=?").bind(sourceRecord.id).first<{ record_json: string }>();
    assert.ok(JSON.parse(retained!.record_json).tags.includes("exclude-from-ui-search"));
    assert.equal((await request("/admin/exclude", { id: "another-resource" })).status, 400);
    assert.equal((await mf.dispatchFetch("https://corpus.test/admin/exclude", { method: "POST", body: JSON.stringify({ id: sourceRecord.id }) })).status, 401);
  });
});
