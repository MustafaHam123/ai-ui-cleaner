import { readFile, stat, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeImportedRecord } from "../src/ingestion.js";
import { loadLocalEnvironment } from "../src/load-env.js";

loadLocalEnvironment();
const base = process.env.AI_UI_CLEANER_CLOUD_URL;
const token = process.env.ADMIN_TOKEN;
if (!base || !token) throw new Error("Set AI_UI_CLEANER_CLOUD_URL and ADMIN_TOKEN (never commit them)");
const origin = new URL(base);
if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname))) throw new Error("Cloud sync requires HTTPS (except local development)");
if (origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Use a bare Worker origin, without credentials, path, query, or fragment");
const input = path.resolve(process.argv[2] ?? "data/local/references.jsonl");
const root = await realpath(path.dirname(input));
const records = (await readFile(input, "utf8")).split(/\r?\n/).filter(Boolean).map(line => normalizeImportedRecord(JSON.parse(line), process.argv.includes("--preserve-review-status")));
const uploaded = new Set<string>();
const failures: Array<{ id: string; error: string }> = [];

async function request(url: URL, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    let response: Response;
    try { response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(60_000), headers: { ...init.headers, authorization: `Bearer ${token}` } }); }
    catch (error) { if (attempt === 2) throw error; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    if (response.ok) return response.json();
    const message = await response.text();
    if ((response.status === 429 || response.status >= 500) && attempt < 2) { await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); continue; }
    throw new Error(`HTTP ${response.status}: ${message.slice(0, 1200)}`);
  }
  throw new Error("Upload retry limit reached");
}

async function upload(key: string, mediaType: string) {
  if (uploaded.has(key)) return;
  if (!/^(assets|raw)\/[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..")) throw new Error("Invalid object key");
  const file = await realpath(path.join(root, key));
  if (!file.startsWith(root + path.sep)) throw new Error("Asset path escapes the corpus directory");
  if ((await stat(file)).size > 8_388_608) throw new Error("Object exceeds upload size limit");
  const endpoint = new URL("/admin/asset", origin); endpoint.searchParams.set("key", key);
  await request(endpoint, { method: "PUT", headers: { "content-type": mediaType }, body: await readFile(file) });
  uploaded.add(key);
}

for (const record of records) {
  try {
    if (!record.implementation) throw new Error("Record missing general implementation guidance");
    for (const asset of record.assets) if (asset.storageKey) await upload(asset.storageKey, asset.mediaType);
    for (const rawKey of [`raw/${record.id}.txt`, `raw/${record.id}-LICENSE.txt`]) {
      try { await stat(path.join(root, rawKey)); await upload(rawKey, "text/plain; charset=utf-8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    const result = await request(new URL("/admin/ingest", origin), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ record, preserveReviewStatus: process.argv.includes("--preserve-review-status") }) });
    console.log(`Synced ${record.id}: ${JSON.stringify(result)}`);
  } catch (error) { failures.push({ id: record.id, error: String(error) }); console.error(`Failed ${record.id}: ${String(error)}`); }
}
await writeFile(path.join(root, "sync-report.json"), JSON.stringify({ target: origin.origin, completedAt: new Date().toISOString(), attempted: records.length, uploadedObjects: uploaded.size, failures }, null, 2));
console.log(`${records.length - failures.length}/${records.length} synced, ${uploaded.size} objects uploaded`);
if (failures.length) process.exitCode = 1;
