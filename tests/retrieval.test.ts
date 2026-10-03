import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { HybridRetriever } from "../src/retrieval.js";
import { parseReferenceRecord } from "../src/schema.js";

async function seedRecords() {
  const text = await readFile(new URL("../data/references.jsonl", import.meta.url), "utf8");
  return text.trim().split(/\r?\n/).map((line) => parseReferenceRecord(JSON.parse(line)));
}

test("hybrid retrieval finds the relevant fintech dashboard pattern", async () => {
  const retriever = new HybridRetriever(await seedRecords());
  const [first] = retriever.search({
    query: "dark fintech dashboard with risk alerts transaction table and precise financial metrics",
    pageType: "dashboard",
    industry: "fintech",
    limit: 4,
  });

  assert.ok(first);
  assert.equal(first.record.id, "pattern-fintech-command-01");
  assert.ok(first.score > 0);
  assert.ok(first.matchedTerms.includes("fintech"));
});

test("license filter excludes inspiration-only records", async () => {
  const retriever = new HybridRetriever(await seedRecords());
  const results = retriever.search({ query: "editorial commerce", licenseOnly: true });
  assert.deepEqual(results, []);
});
