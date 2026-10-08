import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker.js";
import type { Env } from "../cloudflare/store.js";
import { parseWranglerCredential } from "../scripts/provision-cloudflare.js";

test("owner credentials accept OAuth without exposing credential text in errors", () => {
  assert.equal(parseWranglerCredential(JSON.stringify({ type: "oauth", token: "test-only" })), "test-only");
  assert.throws(() => parseWranglerCredential(JSON.stringify({ type: "api_key", key: "do-not-show" })), /Run npx wrangler login/);
});

test("public access requires limiter, never opens administration, and bounds MCP requests", async () => {
  const env = { PUBLIC_MCP: "true" } as Env;
  const request = () => new Request("https://corpus.test/mcp", { method: "POST", body: "{}" });
  assert.equal((await worker.fetch(request(), env)).status, 503);
  const imageRequest = () => new Request("https://corpus.test/reference-image?referenceId=test-record&assetId=test-asset");
  assert.equal((await worker.fetch(imageRequest(), env)).status, 503);
  assert.equal((await worker.fetch(imageRequest(), { PUBLIC_MCP: "false", MCP_READ_TOKEN: "private" } as Env)).status, 401);
  assert.equal((await worker.fetch(new Request("https://corpus.test/admin/stats"), env)).status, 401);
  let key = "";
  env.MCP_RATE_LIMIT = { limit: async input => { key = input.key; return { success: false }; } };
  const limited = new Request("https://corpus.test/mcp", { method: "POST", headers: { "CF-Connecting-IP": "192.0.2.1" }, body: "{}" });
  assert.equal((await worker.fetch(limited, env)).status, 429);
  assert.equal(key, "192.0.2.1");
  assert.equal((await worker.fetch(imageRequest(), env)).status, 429);
  env.MCP_RATE_LIMIT = { limit: async () => ({ success: true }) };
  assert.equal((await worker.fetch(new Request("https://corpus.test/mcp", { method: "POST", body: "x".repeat(64_001) }), env)).status, 413);
  const initialized = await worker.fetch(new Request("https://corpus.test/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } } }) }), env);
  assert.equal(initialized.status, 200);
  assert.ok((await initialized.json() as { result?: unknown }).result);
});
