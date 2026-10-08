import type { ReferenceRepository, ServerOptions } from "./repository.js";
import { imageSignatureMatches, readBoundedBody } from "./http-body.js";

export class ReferenceImageError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** Both MCP and direct image delivery resolve curated IDs, never arbitrary R2 keys. */
export async function readReferenceImage(store: ReferenceRepository, referenceId: string, assetId: string, options: ServerOptions) {
  const record = await store.get(referenceId);
  if (!record) throw new ReferenceImageError(`Reference not found: ${referenceId}`, 404);
  const asset = record.assets.find(candidate => candidate.id === assetId);
  if (!asset) throw new ReferenceImageError(`Asset not found on ${referenceId}: ${assetId}`, 404);
  const maxBytes = options.maxAssetBytes ?? Number.parseInt(process.env.AI_UI_CLEANER_MAX_ASSET_BYTES ?? "8388608", 10);
  let bytes: Uint8Array;
  let contentType: string | undefined;
  if (asset.storageKey && options.readAsset) {
    const stored = await options.readAsset(asset);
    bytes = stored.bytes; contentType = stored.mediaType;
  } else {
    if (!asset.url) throw new ReferenceImageError("This asset requires the Cloudflare storage backend.");
    const url = new URL(asset.url);
    const hosts = new Set(options.assetHosts ?? (process.env.AI_UI_CLEANER_ASSET_HOSTS ?? "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean));
    if (url.protocol !== "https:" || url.username || url.password || !hosts.has(url.hostname.toLowerCase())) {
      throw new ReferenceImageError(`Asset host ${url.hostname} is not allowlisted for HTTPS image retrieval.`);
    }
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000), headers: { Accept: asset.mediaType } });
    if (!response.ok) throw new ReferenceImageError(`Asset fetch failed with HTTP ${response.status}.`);
    contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    bytes = await readBoundedBody(response, maxBytes);
  }
  if (contentType !== asset.mediaType) throw new ReferenceImageError("Asset media type does not match the curated record.");
  if (bytes.byteLength > maxBytes) throw new ReferenceImageError(`Asset exceeds the ${maxBytes}-byte limit.`, 413);
  if (!imageSignatureMatches(bytes, asset.mediaType)) throw new ReferenceImageError("Asset bytes do not match the declared image format.");
  const digest = Buffer.from(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))).toString("hex");
  if (asset.sha256 && asset.sha256 !== digest) throw new ReferenceImageError("Asset digest did not match the curated record.");
  return { record, asset, bytes, digest };
}
