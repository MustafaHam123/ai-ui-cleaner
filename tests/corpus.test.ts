import assert from "node:assert/strict";
import test from "node:test";
import { describeTarget } from "../scripts/collect.js";
import { targets } from "../scripts/corpus-manifest.js";
import { normalizeExport, normalizeFigmaExport } from "../scripts/import-export.js";
import { readBoundedBody, imageSignatureMatches } from "../src/http-body.js";
import { makeChunks } from "../cloudflare/store.js";
import { provisionResources } from "../scripts/provision-cloudflare.js";

test("all collection targets produce schema-valid, adaptation-focused guidance", () => {
  for (const target of targets) {
    const record = describeTarget(target, "**License:** MIT", new Date().toISOString());
    assert.ok(record.implementation?.steps.length);
    assert.equal(record.usage, "reference-only");
    assert.equal(record.license.reuseAllowed, false);
  }
});
test("exports require evidence and keep imported code unreviewed", () => {
  assert.throws(() => normalizeExport({ url: "https://codepen.io/demo" }, "CodePen"), /description/);
  const record = normalizeExport({ url: "https://codepen.io/example/pen/abc", title: "Accessible disclosure", description: "A detail panel toggled by a heading control.", html: "<details><summary>Details</summary>Content</details>" }, "CodePen");
  assert.equal(record.code?.reviewStatus, "unreviewed");
  assert.equal(record.license.reuseAllowed, false);
});
test("Figma imports only explicitly selected nodes and never invent screenshots", () => {
  const records = normalizeFigmaExport({ document: { id: "0:0", type: "DOCUMENT", children: [{ id: "1:2", name: "Settings", type: "FRAME", layoutMode: "VERTICAL", itemSpacing: 16, children: [{ id: "1:3", type: "TEXT", name: "Title" }] }] } }, "selectedFileKey", ["1:2"]);
  assert.equal(records.length, 1);
  assert.equal(records[0].assets.length, 0);
  assert.ok(records[0].implementation?.steps[0].includes("vertical"));
  assert.throws(() => normalizeFigmaExport({ document: { id: "0:0" } }, "key", ["missing"]), /missing/);
});
test("bounded reads reject oversized streams even without content-length", async () => {
  await assert.rejects(readBoundedBody(new Response("x".repeat(20)), 10), RangeError);
  assert.equal(new TextDecoder().decode(await readBoundedBody(new Response("hello"), 10)), "hello");
  assert.equal(imageSignatureMatches(new TextEncoder().encode("<script>bad</script>"), "image/png"), false);
});
test("chunks are stable, short, and do not embed unreviewed source code", async () => {
  const record = describeTarget(targets[0], "", new Date().toISOString());
  record.code = { content: "unreviewedSecretFunctionXYZ()", language: "js", dependencies: [], reviewStatus: "unreviewed" };
  assert.deepEqual(await makeChunks(record), await makeChunks(record));
  assert.ok((await makeChunks(record)).every(c => c.id.length <= 64 && c.content.length < 1800 && !c.content.includes("unreviewedSecretFunctionXYZ")));
});
test("cloud provisioning reuses matching resources and creates missing filter indexes", async () => {
  const calls: Array<{ endpoint: string; method: string; body: unknown }> = [];
  const api = async <T>(endpoint: string, method = "GET", body?: unknown) => {
    calls.push({ endpoint, method, body });
    const result = endpoint.includes("/d1/database?") ? [{ uuid: "existing-db", name: "ai-ui-cleaner" }]
      : endpoint.endsWith("metadata_index/list") ? { metadataIndexes: [{ propertyName: "source", indexType: "string" }] }
      : endpoint.endsWith("vectorize/v2/indexes/ai-ui-cleaner") ? { config: { dimensions: 768, metric: "cosine" } } : {};
    return { success: true, result: result as T };
  };
  assert.equal((await provisionResources(api, "a".repeat(32))).databaseId, "existing-db");
  assert.equal(calls.filter(c => c.method === "POST").length, 2);
  assert.ok(calls.filter(c => c.method === "POST").every(c => c.endpoint.endsWith("metadata_index/create")));
});
