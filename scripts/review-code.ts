import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { normalizeImportedRecord } from "../src/ingestion.js";

const args = process.argv.slice(2);
const checks = args.filter(a => /^[a-z0-9._-]+=[a-f0-9]{64}$/.test(a));
const noteIndex = args.indexOf("--note"), note = args[noteIndex + 1];
if (!checks.length || noteIndex < 0 || !note || note.length < 20) throw new Error("After inspecting code and license: npm run corpus:review -- id=sha256 [id=sha256 ...] --note 'Review evidence and adaptation requirements'");
const file = "data/local/references.jsonl";
const records = (await readFile(file, "utf8")).split(/\r?\n/).filter(Boolean).map(line => normalizeImportedRecord(JSON.parse(line), true));
const events: object[] = [];
for (const check of checks) {
  const [id, digest] = check.split("="); const record = records.find(r => r.id === id);
  if (!record?.code || !record.license.reuseAllowed) throw new Error(`Missing licensed code on ${id}`);
  const actual = createHash("sha256").update(record.code.content).digest("hex");
  if (actual !== digest) throw new Error(`Code changed since review: ${id}`);
  record.code.reviewStatus = "reviewed";
  if (record.implementation && !record.implementation.adaptation.some(s => s.includes("import aliases"))) record.implementation.adaptation.push("Resolve source-specific import aliases such as cn and local button components using the target project's own utilities; do not install or execute imports blindly.");
  record.code.dependencies = [...new Set([...record.code.content.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]).filter(v => !v.startsWith("@/") && !v.startsWith(".")))];
  const review = `Static code review of SHA-256 ${actual}: ${note}`;
  record.curatorNotes = `${record.curatorNotes ?? ""} ${review}`.trim().slice(0, 4000);
  events.push({ id, sha256: actual, reviewedAt: new Date().toISOString(), note });
}
await writeFile(file, records.map(r => JSON.stringify(r)).join("\n") + "\n");
await appendFile("data/local/code-review-ledger.jsonl", events.map(e => JSON.stringify(e)).join("\n") + "\n");
console.log(`Reviewed ${checks.length} code assets. Sync with --preserve-review-status to retain this explicit review; future recollection resets code to unreviewed.`);
