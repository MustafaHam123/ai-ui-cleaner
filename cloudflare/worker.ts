import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createAiUiCleanerServer } from "../src/server.js";
import { normalizeImportedRecord } from "../src/ingestion.js";
import { CloudflareStore, type Env } from "./store.js";
import { readBoundedBody } from "../src/http-body.js";
import { readReferenceImage, ReferenceImageError } from "../src/reference-image.js";
import type { ServerOptions } from "../src/repository.js";

async function authorized(request: Request, token: string | undefined) {
  if (!token) return false;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const encode = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [a, b] = await Promise.all([encode(supplied), encode(token)]);
  const left = new Uint8Array(a), right = new Uint8Array(b);
  let difference = 0; for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

async function authorizeRead(request: Request, env: Env): Promise<Response | undefined> {
  if (env.PUBLIC_MCP !== "true") {
    if (!await authorized(request, env.MCP_READ_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  } else {
    if (!env.MCP_RATE_LIMIT) return Response.json({ error: "Public access is not configured safely" }, { status: 503 });
    const key = request.headers.get("CF-Connecting-IP") ?? "anonymous";
    if (!(await env.MCP_RATE_LIMIT.limit({ key })).success) return Response.json({ error: "Too many requests" }, { status: 429, headers: { "retry-after": "60" } });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const store = new CloudflareStore(env);
    if (url.pathname === "/health") return Response.json({ ok: true, service: "ai-ui-cleaner" });
    if (url.pathname.startsWith("/admin/")) {
      if (!await authorized(request, env.ADMIN_TOKEN)) return Response.json({ error: "Unauthorized" }, { status: 401 });
      if (url.pathname === "/admin/stats" && request.method === "GET") return Response.json(await store.stats());
      if (url.pathname === "/admin/exclude" && request.method === "POST") {
        try {
          const input = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 1024)));
          if (typeof input.id !== "string" || !/^dribbble-[a-f0-9]{32}$/.test(input.id)) return Response.json({ error: "Invalid corpus image ID" }, { status: 400 });
          return Response.json(await store.excludeFromUiSearch(input.id));
        } catch (error) { return Response.json({ error: error instanceof RangeError ? "Request too large" : "Exclusion failed" }, { status: error instanceof RangeError ? 413 : 503 }); }
      }
      if (url.pathname === "/admin/ingest" && request.method === "POST") {
        try {
          const raw = new TextDecoder().decode(await readBoundedBody(request, 512_000));
          const input = JSON.parse(raw);
          const record = normalizeImportedRecord(input.record ?? input, input.preserveReviewStatus === true);
          if (!record.implementation) return Response.json({ error: "Every cloud reference requires implementation guidance" }, { status: 400 });
          // Owner-only ingestion can deliberately stage keyword records while
          // AI quota is unavailable. Public MCP cannot change this setting.
          try { return Response.json(await store.upsert(record, input.indexSemantic !== false)); }
          catch (error) { console.error("Storage or embedding ingestion failed", error); return Response.json({ error: "Storage or embedding ingestion failed; retry this record. Keyword data may already be saved." }, { status: 503 }); }
        } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Ingestion failed" }, { status: error instanceof RangeError ? 413 : 400 }); }
      }
      if (url.pathname === "/admin/asset" && request.method === "PUT") {
        const key = url.searchParams.get("key");
        if (!key || !/^(assets|raw)\/[a-zA-Z0-9._/-]+$/.test(key) || key.includes("..")) return Response.json({ error: "Invalid storage key" }, { status: 400 });
        try {
          const bytes = await readBoundedBody(request, 8_388_608);
          await env.ASSETS.put(key, bytes, { httpMetadata: { contentType: request.headers.get("content-type") ?? "application/octet-stream" } });
          return Response.json({ key, bytes: bytes.byteLength });
        } catch (error) { return Response.json({ error: error instanceof RangeError ? "Object exceeds 8 MB" : "Object upload failed" }, { status: error instanceof RangeError ? 413 : 503 }); }
      }
      return new Response("Not found", { status: 404 });
    }
    const imageOptions: ServerOptions = {
      assetHosts: (env.ASSET_HOSTS ?? "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean), maxAssetBytes: 8_388_608,
      assetUrl: (referenceId, assetId) => {
        const imageUrl = new URL("/reference-image", url.origin);
        imageUrl.searchParams.set("referenceId", referenceId); imageUrl.searchParams.set("assetId", assetId);
        return imageUrl.href;
      },
      readAsset: async asset => {
        const object = await env.ASSETS.get(asset.storageKey!);
        if (!object) throw new ReferenceImageError("Screenshot object missing", 404);
        if (object.size > 8_388_608) throw new ReferenceImageError("Screenshot object oversized", 413);
        return { bytes: new Uint8Array(await object.arrayBuffer()), mediaType: object.httpMetadata?.contentType ?? "" };
      },
    };
    if (url.pathname === "/reference-image") {
      if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      const denied = await authorizeRead(request, env); if (denied) return denied;
      const referenceId = url.searchParams.get("referenceId") ?? "", assetId = url.searchParams.get("assetId") ?? "";
      if (![referenceId, assetId].every(id => /^[a-zA-Z0-9._-]{3,128}$/.test(id))) return Response.json({ error: "Invalid reference or asset ID" }, { status: 400 });
      try {
        const { asset, bytes, digest } = await readReferenceImage(store, referenceId, assetId, imageOptions);
        return new Response(request.method === "HEAD" ? null : Uint8Array.from(bytes).buffer, { headers: {
          "content-type": asset.mediaType, "content-length": String(bytes.byteLength),
          "content-disposition": "inline", "x-content-type-options": "nosniff",
          "cache-control": env.PUBLIC_MCP === "true" ? "public, max-age=300" : "private, no-store",
          etag: `"${digest}"`,
        } });
      } catch (error) {
        return Response.json({ error: "Screenshot unavailable" }, { status: error instanceof ReferenceImageError ? error.status : 502 });
      }
    }
    if (url.pathname !== "/mcp") return Response.json({ service: "ai-ui-cleaner", endpoint: "/mcp", protocol: "MCP Streamable HTTP" }, { status: url.pathname === "/" ? 200 : 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const denied = await authorizeRead(request, env); if (denied) return denied;
    let boundedRequest: Request;
    try {
      const bytes = await readBoundedBody(request, 64_000);
      boundedRequest = new Request(request.url, { method: "POST", headers: request.headers, body: new Uint8Array(bytes).buffer });
    } catch { return Response.json({ error: "MCP request exceeds 64 KB" }, { status: 413 }); }
    const server = createAiUiCleanerServer(store, imageOptions);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try { return await transport.handleRequest(boundedRequest); }
    finally { await server.close(); }
  },
};
