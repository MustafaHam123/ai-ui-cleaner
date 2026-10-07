import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { imageSignatureMatches } from "../src/http-body.js";
import type { CollectedImage } from "../src/image-metadata.js";

// Downloads only exact public CDN URLs exported from visible source pages.
// No source-page fetches, login credentials, generated URLs or gate bypasses.
const root = "data/local/dribbble";
await mkdir(`${root}/images`, { recursive: true });
const prior = JSON.parse(await readFile(`${root}/images.json`, "utf8"));
const images = new Map<string, CollectedImage>((prior.images as CollectedImage[]).map(image => [image.sha256, image]));
const bySource = new Map([...images.values()].map(image => [new URL(image.sourceImageUrl).pathname, image]));
const rows = new Map<string, { image: string; source: string; author?: string; sourceTitle?: string; sourceDescription?: string }>();
for (const file of await readdir(`${root}/source-exports`)) {
  if (!/^[a-f0-9]{16}\.json$/.test(file)) continue;
  for (const row of JSON.parse(await readFile(`${root}/source-exports/${file}`, "utf8"))) {
    const u = new URL(row.image);
    if (u.protocol !== "https:" || u.hostname !== "cdn.dribbble.com" || !u.pathname.startsWith("/userupload/") || !/^\/shots\/\d+(?:-[^/?#]*)?$/.test(row.source)) throw new Error("Invalid observed source URL");
    rows.set(u.pathname, { ...rows.get(u.pathname), ...row });
    const existing = bySource.get(u.pathname);
    if (existing) {
      existing.sourceUrl = `https://dribbble.com${row.source}`;
      existing.author = row.author ?? existing.author;
      existing.sourceTitle = row.sourceTitle ?? existing.sourceTitle;
      existing.sourceDescription = row.sourceDescription ?? existing.sourceDescription;
    }
  }
}
const pending = [...rows].filter(([key]) => !bySource.has(key)).map(([, row]) => row);
let next = 0;
const failures: Array<{ source: string; error: string }> = [];
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < pending.length && images.size < 1000) {
    const row = pending[next++];
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          response = await fetch(row.image, { redirect: "error", signal: AbortSignal.timeout(30_000) });
          if (response.ok) break;
          if ([401, 403, 429].includes(response.status)) throw new Error(`Source restriction HTTP ${response.status}; no bypass attempted`);
          throw new Error(`Image HTTP ${response.status}`);
        } catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
      }
      if (!response?.ok) throw new Error("Image fetch failed");
      const type = response.headers.get("content-type")?.split(";")[0] ?? "";
      const declared = Number(response.headers.get("content-length"));
      if (declared > 8_388_608) throw new Error("Image exceeds size limit");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 8_388_608 || !imageSignatureMatches(bytes, type)) throw new Error("Invalid image bytes");
      const ext = ({ "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif" } as Record<string, string>)[type];
      if (!ext) throw new Error("Unsupported image format");
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (images.has(hash) || images.size >= 1000) continue;
      const localPath = `${root}/images/${hash}.${ext}`;
      await writeFile(localPath, bytes);
      images.set(hash, { sha256: hash, localPath, bytes: bytes.length, mediaType: type,
        storageKey: `assets/dribbble/${hash}.${ext}`, sourceImageUrl: row.image,
        sourceUrl: `https://dribbble.com${row.source}`, author: row.author,
        sourceTitle: row.sourceTitle, sourceDescription: row.sourceDescription });
      if (images.size % 20 === 0) console.log(`${images.size}/1000 unique design images downloaded`);
    } catch (error) { failures.push({ source: row.source, error: error instanceof Error ? error.message : "Download failed" }); }
  }
}));
await writeFile(`${root}/images.json`, JSON.stringify({ ...prior, capturedAt: new Date().toISOString(), downloaded: images.size,
  status: images.size >= 1000 ? "collection target reached; captioning tracked separately" : "partial; collection in progress",
  images: [...images.values()] }, null, 2));
await writeFile(`${root}/download-report.json`, JSON.stringify({ observedSources: rows.size, downloaded: images.size, failures }, null, 2));
console.log(`${images.size}/1000 unique, signature-verified images; ${failures.length} failures`);
if (failures.length) process.exitCode = 1;
