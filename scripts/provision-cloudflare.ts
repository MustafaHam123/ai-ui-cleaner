import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadLocalEnvironment } from "../src/load-env.js";

type Envelope<T> = { success: boolean; result: T; errors?: Array<{ code: number; message: string }>; result_info?: { total_pages?: number } };
type Api = <T>(endpoint: string, method?: string, body?: unknown, optional?: boolean) => Promise<Envelope<T> | undefined>;
const DATABASE = "ai-ui-cleaner", BUCKET = "ai-ui-cleaner-corpus", INDEX = "ai-ui-cleaner";
const execFileAsync = promisify(execFile);

export function parseWranglerCredential(raw: string): string {
  const value = JSON.parse(raw);
  if (!["oauth", "api_token"].includes(value.type) || typeof value.token !== "string" || !value.token) throw new Error("Wrangler has no usable OAuth/API-token credential. Run npx wrangler login first.");
  return value.token;
}

async function cloudflareToken() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  try {
    // Never echo this command's output: it contains the owner's credential.
    const { stdout } = await execFileAsync(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), "auth", "token", "--json"], { env: { ...process.env, WRANGLER_SEND_METRICS: "false" }, maxBuffer: 64_000 });
    return parseWranglerCredential(stdout);
  } catch { throw new Error("Cloudflare is not connected. Run npx wrangler login, approve the browser prompt, then rerun cloud:setup. No token needs to be copied."); }
}

export async function provisionResources(api: Api, account: string) {
  if (!/^[a-f0-9]{32}$/i.test(account)) throw new Error("Invalid Cloudflare account ID");
  const prefix = `/accounts/${account}`;
  let database: { uuid: string; name: string } | undefined;
  for (let page = 1; ; page++) {
    const result = await api<Array<{ uuid: string; name: string }>>(`${prefix}/d1/database?per_page=100&page=${page}`);
    if (!result) throw new Error("Cannot list D1 databases");
    database = result.result.find(r => r.name === DATABASE);
    if (database || page >= (result.result_info?.total_pages ?? 1)) break;
  }
  database ??= (await api<{ uuid: string; name: string }>(`${prefix}/d1/database`, "POST", { name: DATABASE }))?.result;
  if (!database?.uuid) throw new Error("D1 creation returned no database ID");
  if (!await api(`${prefix}/r2/buckets/${BUCKET}`, "GET", undefined, true)) await api(`${prefix}/r2/buckets`, "POST", { name: BUCKET });
  let vector = await api<{ config: { dimensions: number; metric: string } }>(`${prefix}/vectorize/v2/indexes/${INDEX}`, "GET", undefined, true);
  vector ??= await api(`${prefix}/vectorize/v2/indexes`, "POST", { name: INDEX, description: "AI UI Cleaner reference-only corpus", config: { dimensions: 768, metric: "cosine" } });
  if (vector?.result.config.dimensions !== 768 || vector.result.config.metric !== "cosine") throw new Error("Existing Vectorize index has an incompatible embedding configuration; it was not modified");
  const metadata = await api<{ metadataIndexes?: Array<{ propertyName: string; indexType: string }> }>(`${prefix}/vectorize/v2/indexes/${INDEX}/metadata_index/list`);
  for (const [propertyName, indexType] of [["source", "string"], ["kind", "string"], ["reuseAllowed", "boolean"]]) {
    const current = metadata?.result.metadataIndexes?.find(m => m.propertyName === propertyName);
    if (current && current.indexType !== indexType) throw new Error(`Incompatible metadata index: ${propertyName}`);
    if (!current) await api(`${prefix}/vectorize/v2/indexes/${INDEX}/metadata_index/create`, "POST", { propertyName, indexType });
  }
  return { databaseId: database.uuid, databaseName: DATABASE, bucketName: BUCKET, vectorIndex: INDEX };
}

async function wrangler(args: string[], stdin?: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.resolve("node_modules/wrangler/bin/wrangler.js"), ...args], { stdio: [stdin === undefined ? "inherit" : "pipe", "inherit", "inherit"], env: { ...process.env, CI: "true", WRANGLER_SEND_METRICS: "false" } });
    if (stdin !== undefined) child.stdin?.end(stdin);
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Wrangler failed (${code})`)));
  });
}

async function main() {
  loadLocalEnvironment();
  const token = await cloudflareToken();
  const api: Api = async <T>(endpoint: string, method = "GET", body?: unknown, optional = false) => {
    const response = await fetch(`https://api.cloudflare.com/client/v4${endpoint}`, { method, redirect: "error", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
    if (optional && response.status === 404) return undefined;
    const value = await response.json() as Envelope<T>;
    if (!response.ok || !value.success) throw new Error(`Cloudflare ${method} ${endpoint.split("?")[0]} failed (${response.status}): ${value.errors?.map(e => `${e.code}: ${e.message}`).join("; ") ?? "unknown API error"}`);
    return value;
  };
  let account = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!account) {
    const accounts = (await api<Array<{ id: string; name: string }>>("/accounts?per_page=50"))!.result;
    if (accounts.length !== 1) throw new Error("Set CLOUDFLARE_ACCOUNT_ID to the intended account; automatic selection requires exactly one accessible account");
    account = accounts[0].id;
  }
  const resources = await provisionResources(api, account);
  const publicMcp = process.argv.includes("--public");
  const config = {
    name: DATABASE, account_id: account, main: "cloudflare/worker.ts", compatibility_date: "2026-10-04", compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    // Dedicated workers.dev endpoint only: never bind this library to existing websites/domains.
    routes: [],
    vars: { PUBLIC_MCP: publicMcp ? "true" : "false" },
    ratelimits: [{ name: "MCP_RATE_LIMIT", namespace_id: "810274", simple: { limit: 120, period: 60 } }],
    d1_databases: [{ binding: "DB", database_name: DATABASE, database_id: resources.databaseId, migrations_dir: "cloudflare/migrations" }],
    r2_buckets: [{ binding: "ASSETS", bucket_name: BUCKET }], vectorize: [{ binding: "VECTORS", index_name: INDEX }], ai: { binding: "AI" },
  };
  await writeFile("wrangler.generated.json", JSON.stringify(config, null, 2));
  console.log("D1, R2, and Vectorize provisioned; deployment config saved to wrangler.generated.json. Existing matching resources were reused.");
  if (!process.argv.includes("--deploy")) return;
  await mkdir("data/local", { recursive: true });
  let secrets: { ADMIN_TOKEN: string; MCP_READ_TOKEN: string };
  try { secrets = JSON.parse(await readFile("data/local/cloud-secrets.json", "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; secrets = { ADMIN_TOKEN: randomBytes(32).toString("hex"), MCP_READ_TOKEN: randomBytes(32).toString("hex") }; }
  secrets.ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? secrets.ADMIN_TOKEN;
  secrets.MCP_READ_TOKEN = process.env.MCP_READ_TOKEN ?? secrets.MCP_READ_TOKEN;
  if (secrets.ADMIN_TOKEN.length < 32 || secrets.MCP_READ_TOKEN.length < 32 || secrets.ADMIN_TOKEN === secrets.MCP_READ_TOKEN) throw new Error("Use different admin and read secrets of at least 32 characters");
  await writeFile("data/local/cloud-secrets.json", JSON.stringify(secrets, null, 2), { mode: 0o600 });
  const cliConfig = ["--config", "wrangler.generated.json"];
  await wrangler(["d1", "migrations", "apply", DATABASE, "--remote", ...cliConfig]);
  await wrangler(["deploy", ...cliConfig]);
  for (const [name, value] of Object.entries(secrets)) await wrangler(["secret", "put", name, ...cliConfig], value + "\n");
  const subdomain = (await api<{ subdomain: string }>(`/accounts/${account}/workers/subdomain`))?.result.subdomain;
  if (!subdomain || !/^[a-z0-9-]+$/i.test(subdomain)) throw new Error("Deployment completed but the account's workers.dev subdomain could not be determined");
  const origin = `https://${DATABASE}.${subdomain}.workers.dev`;
  let healthy = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const health = await fetch(`${origin}/health`, { redirect: "error", signal: AbortSignal.timeout(10_000) });
      healthy = health.ok && (await health.json() as { service?: string }).service === DATABASE;
    } catch { /* A new workers.dev hostname may still be activating its certificate. */ }
    if (healthy) break;
    if (attempt % 6 === 0) console.log("Waiting for the dedicated Worker hostname to become reachable...");
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  if (!healthy) throw new Error("Deployed origin is not reachable yet; rerun setup after workers.dev activation. No existing domain settings were changed.");
  await writeFile("data/local/cloud-deployment.json", JSON.stringify({ origin, mcpUrl: `${origin}/mcp`, public: publicMcp }, null, 2));
  if (process.argv.includes("--sync")) {
    const childEnv = { ...process.env, AI_UI_CLEANER_CLOUD_URL: origin, ADMIN_TOKEN: secrets.ADMIN_TOKEN, MCP_READ_TOKEN: publicMcp ? "" : secrets.MCP_READ_TOKEN };
    for (const [script, args] of [["sync-cloud.ts", ["data/local/references.jsonl", "--preserve-review-status"]], ["smoke-cloud.ts", []]] as const) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", `scripts/${script}`, ...args], { stdio: "inherit", env: childEnv });
        child.on("error", reject);
        child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${script} failed (${code}); rerun setup to retry`)));
      });
    }
    if (publicMcp) await writeFile("data/local/mcp-public.json", JSON.stringify({ mcpServers: { "ai-ui-cleaner": { type: "http", url: `${origin}/mcp` } } }, null, 2));
  }
  console.log(`Hosted MCP: ${origin}/mcp (${publicMcp ? "public; no login or key" : "private bearer access"}). Admin secrets remain in ignored data/local/cloud-secrets.json.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
