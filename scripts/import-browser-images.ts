import { readFile, mkdir, copyFile, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { imageSignatureMatches } from "../src/http-body.js";
import type { CollectedImage } from "../src/image-metadata.js";

// Imports an already downloaded browser asset bundle; never bypasses source-site gates.
const manifestPath = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Supply the browser image-bundle manifest");
const bundleRoot = await realpath(path.dirname(manifestPath));
const bundle = JSON.parse(await readFile(manifestPath, "utf8")) as { assets: Array<{ path: string; url: string; contentType: string; kind: string }> };
const root = "data/local/dribbble";
await mkdir(`${root}/images`, { recursive: true });
const unique = new Map<string, CollectedImage>();
try {
  const prior = JSON.parse(await readFile(`${root}/images.json`, "utf8"));
  for (const image of prior.images as CollectedImage[]) unique.set(image.sha256, image);
} catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const originalCount = unique.size;
const sourcePaths = new Set([...unique.values()].map(image => new URL(image.sourceImageUrl).pathname));
for (const item of bundle.assets) {
  const url = new URL(item.url);
  if (item.kind !== "image" || url.protocol !== "https:" || url.hostname !== "cdn.dribbble.com" || !url.pathname.startsWith("/userupload/")) continue;
  if (unique.size >= 1000 || sourcePaths.has(url.pathname)) continue;
  const resize = url.searchParams.get("resize")?.split("x").map(Number);
  if (resize && (resize[0] < 400 || resize[1] < 300)) continue;
  const sourcePath = await realpath(item.path);
  if (!sourcePath.startsWith(bundleRoot + path.sep)) throw new Error("Bundle file escapes its directory");
  const bytes = await readFile(sourcePath);
  if (bytes.length > 8_388_608 || !imageSignatureMatches(bytes, item.contentType)) throw new Error("Invalid or oversized design image");
  const ext = ({ "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif" } as Record<string, string>)[item.contentType];
  if (!ext) throw new Error("Unsupported image format");
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (unique.has(hash)) continue;
  const localPath = `${root}/images/${hash}.${ext}`;
  await copyFile(sourcePath, localPath);
  unique.set(hash, { sha256: hash, sourceImageUrl: item.url, mediaType: item.contentType, storageKey: `assets/dribbble/${hash}.${ext}`, localPath, bytes: bytes.length });
  sourcePaths.add(url.pathname);
}
const images = [...unique.values()];
await writeFile(`${root}/images.json`, JSON.stringify({ capturedAt: new Date().toISOString(), galleryUrl: "https://dribbble.com/search/web-design", requested: 1000, downloaded: images.length, status: images.length >= 1000 ? "collection target reached; captioning tracked separately" : "partial; collection in progress", images }, null, 2));
console.log(`${images.length} unique, signature-verified images (${images.length - originalCount} added) saved to ${root}/images`);
if (process.argv.includes("--upload")) {
  const deployment = JSON.parse(await readFile("data/local/cloud-deployment.json", "utf8"));
  const origin = new URL(deployment.origin);
  if (origin.origin !== "https://ai-ui-cleaner.ai-ui-cleaner.workers.dev") throw new Error("Unexpected deployment; only the isolated UI corpus endpoint is allowed");
  const secrets = JSON.parse(await readFile("data/local/cloud-secrets.json", "utf8"));
  let next = 0;
  const failures: string[] = [];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < images.length) {
      const image = images[next++];
      try {
        const endpoint = new URL("/admin/asset", origin);
        endpoint.searchParams.set("key", image.storageKey);
        const response = await fetch(endpoint, { method: "PUT", redirect: "error", headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": image.mediaType }, body: await readFile(image.localPath), signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      } catch { failures.push(image.storageKey); }
    }
  }));
  await writeFile(`${root}/upload-report.json`, JSON.stringify({ targetBucket: "ai-ui-cleaner-corpus", uploaded: images.length - failures.length, failures }, null, 2));
  console.log(`${images.length - failures.length}/${images.length} images uploaded to the isolated corpus bucket. Images are staged, not advertised as curated RAG references.`);
  if (failures.length) process.exitCode = 1;
}
