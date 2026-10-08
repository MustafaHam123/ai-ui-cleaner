import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { imageReference, imageCaptionSchema, sourceImageReference, type CollectedImage } from "../src/image-metadata.js";
import { imageSignatureMatches } from "../src/http-body.js";

// Storage-only checkpoint; no AI calls, plan upgrades, or fabricated captions.
const root = path.resolve("data/local/dribbble");
const dataset = JSON.parse(await readFile(path.join(root, "images.json"), "utf8"));
const images = dataset.images as CollectedImage[];
const deployment = JSON.parse(await readFile("data/local/cloud-deployment.json", "utf8"));
if (deployment.origin !== "https://ai-ui-cleaner.ai-ui-cleaner.workers.dev") throw new Error("Unexpected corpus endpoint");
const secrets = JSON.parse(await readFile("data/local/cloud-secrets.json", "utf8"));
await mkdir(path.join(root, "staged-metadata"), { recursive: true });
let next = 0, stored = 0, analyzed = 0, published = 0, keywordOnly = 0, excluded = 0, imageUploads = 0;
const records = new Map<string, ReturnType<typeof imageReference>>();
const failures: Array<{ sha256: string; error: string }> = [];
const indexFailures: Array<{ sha256: string; error: string }> = [];
async function upload(key: string, contentType: string, body: Buffer | string) {
  const url = new URL("/admin/asset", deployment.origin); url.searchParams.set("key", key);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { method: "PUT", redirect: "error", headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": contentType }, body: typeof body === "string" ? body : new Uint8Array(body), signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`Storage HTTP ${res.status}`);
      return;
    } catch (error) { if (attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
  }
}
await Promise.all(Array.from({ length: 6 }, async () => {
  while (next < images.length) {
    const image = images[next++];
    try {
      const file = await realpath(image.localPath);
      if (!file.startsWith(root + path.sep) || !/^assets\/dribbble\/[a-f0-9]{64}\.(webp|png|jpg|gif)$/.test(image.storageKey)) throw new Error("Invalid corpus image path/key");
      const bytes = await readFile(file);
      if (bytes.length > 8_388_608 || !imageSignatureMatches(bytes, image.mediaType) || createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new Error("Image integrity check failed");
      let existing;
      try { existing = JSON.parse(await readFile(path.join(root, "metadata", `${image.sha256}.json`), "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const parsed = existing?.promptVersion === 2 && existing.imageSha256 === image.sha256 ? imageCaptionSchema.safeParse(existing.caption) : undefined;
      const caption = parsed?.success ? parsed.data : undefined;
      if (caption) analyzed++;
      const sourceTitle = image.sourceTitle || (image.sourceUrl ? decodeURIComponent(new URL(image.sourceUrl).pathname.replace(/^\/shots\/\d+-?/, "")).replaceAll("-", " ") : undefined);
      const metadata = { ...existing, version: 1, imageSha256: image.sha256, imageStorageKey: image.storageKey,
        sourceImageUrl: image.sourceImageUrl, mediaType: image.mediaType, bytes: image.bytes,
        source: { url: image.sourceUrl ?? image.sourceImageUrl, author: image.author, title: sourceTitle,
          description: image.sourceDescription, capturedAt: dataset.capturedAt },
        description: caption?.visibleDescription ?? image.sourceDescription ?? sourceTitle ?? "Source description unavailable; visual analysis pending.",
        descriptionEvidence: caption ? "machine-vision-caption" : image.sourceDescription ? "source-provided-alt-text" : sourceTitle ? "source-url-title" : "unavailable",
        reviewStatus: caption ? "machine-captioned" : "pending-visual-analysis",
        usage: "reference-only", license: { reuseAllowed: false, notes: "No asset/code reuse license verified. Public visibility is not a reuse license." },
        processing: { visualCaption: caption ? "complete" : "pending-ai-quota",
          semanticIndex: existing?.publishedAt ? "submitted" : "not-confirmed",
          uiClassification: caption ? (caption.isInterface ? "interface" : "non-interface") : "unverified" },
        retrievalGuidance: { status: caption ? (caption.isInterface ? "inspect-before-adapting" : "exclude-from-ui-search") : "not-ready-for-primary-reference",
          whenToRetrieve: caption?.useWhen ?? [],
          queryAliases: caption?.queryAliases ?? (sourceTitle ? [sourceTitle] : []),
          howToUse: "View the content[] image block from get_reference_asset before visual claims. Reconstruct a chosen frame's visible geometry, then adapt content with the user's existing components; respect source branding and asset/code licenses.",
          implementationStatus: caption ? "unverified-adaptation-proposal" : "pending-image-inspection",
          limitations: caption?.limitations ?? ["Visual layout has not been analyzed. Source text is not pixel verification; implementation, behavior, responsiveness and accessibility are unknown."] },
        storedAt: new Date().toISOString(),
      };
      let record: ReturnType<typeof sourceImageReference>;
      try { record = caption ? (caption.isInterface ? imageReference(image, caption, existing.captionedAt, existing.model) : undefined) : sourceImageReference(image); }
      catch (error) {
        indexFailures.push({ sha256: image.sha256, error: error instanceof Error ? error.message : "Record validation failed" });
        metadata.retrievalGuidance.status = "not-ready-for-primary-reference";
      }
      if (record) {
        records.set(record.id, record);
        if (existing?.publishedAt) published++;
      }
      if (process.argv.includes("--resume-stored")) {
        try {
          const saved = JSON.parse(await readFile(path.join(root, "staged-metadata", `${image.sha256}.json`), "utf8"));
          if (saved.imageSha256 === image.sha256 && saved.storedAt && saved.source?.url === metadata.source.url
            && saved.source?.description === metadata.source.description && saved.captionedAt === existing?.captionedAt
            && saved.publishedAt === existing?.publishedAt && saved.processing?.semanticIndex !== "keyword-index-failed"
            && (record ? existing?.publishedAt || ["pending-ai-quota", "keyword-only"].includes(saved.processing?.semanticIndex) : saved.processing?.semanticIndex === "excluded-non-interface")) {
            stored++;
            if (record && !existing?.publishedAt) keywordOnly++;
            if (caption && !caption.isInterface) excluded++;
            continue;
          }
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
      let imageAlreadyStored = false;
      try {
        const saved = JSON.parse(await readFile(path.join(root, "staged-metadata", `${image.sha256}.json`), "utf8"));
        imageAlreadyStored = Boolean(saved.storedAt && saved.imageSha256 === image.sha256 && saved.imageStorageKey === image.storageKey);
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!imageAlreadyStored) { await upload(image.storageKey, image.mediaType, bytes); imageUploads++; }
      if (caption && !caption.isInterface) {
        const res = await fetch(new URL("/admin/exclude", deployment.origin), { method: "POST", redirect: "error",
          headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ id: `dribbble-${image.sha256.slice(0, 32)}` }), signal: AbortSignal.timeout(30_000) });
        if (!res.ok || (await res.json() as { excluded?: boolean }).excluded !== true) throw new Error("Non-interface exclusion not confirmed");
        metadata.processing.semanticIndex = "excluded-non-interface";
        excluded++;
      }
      if (record && !existing?.publishedAt) {
        try {
          const res = await fetch(new URL("/admin/ingest", deployment.origin), { method: "POST", redirect: "error",
          headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": "application/json" },
          body: JSON.stringify({ record, indexSemantic: false }), signal: AbortSignal.timeout(30_000) });
          if (!res.ok) throw new Error(`Keyword ingestion HTTP ${res.status}`);
          const receipt = await res.json() as { semanticIndexed: boolean };
          if (receipt.semanticIndexed !== false) throw new Error("Keyword-only receipt not confirmed");
          metadata.processing.semanticIndex = "keyword-only";
          metadata.retrievalGuidance.status = caption ? "inspect-before-adapting" : "source-text-only-inspect-before-use";
          keywordOnly++;
        } catch (error) {
          indexFailures.push({ sha256: image.sha256, error: error instanceof Error ? error.message : "Indexing failed" });
          metadata.processing.semanticIndex = "keyword-index-failed";
          metadata.retrievalGuidance.status = "not-ready-for-primary-reference";
        }
      }
      await upload(`raw/dribbble/${image.sha256}.json`, "application/json", JSON.stringify(metadata));
      await writeFile(path.join(root, "staged-metadata", `${image.sha256}.json`), JSON.stringify(metadata, null, 2));
      stored++;
      if (stored % 100 === 0) console.log(`${stored}/${images.length} images and metadata sidecars stored`);
    } catch (error) { failures.push({ sha256: image.sha256, error: error instanceof Error ? error.message : "Storage failed" }); }
  }
}));
await writeFile(path.join(root, "references.jsonl"), [...records.values()].map(record => JSON.stringify(record)).join("\n") + "\n");
await writeFile(path.join(root, "stage-report.json"), JSON.stringify({ targetBucket: "ai-ui-cleaner-corpus", completedAt: new Date().toISOString(),
  total: images.length, stored, visuallyCaptioned: analyzed, referenceRecords: records.size, confirmedPublishedReceipts: published, keywordOnlyRecords: keywordOnly,
  pendingVisualCaptions: images.length - analyzed, excludedNonInterfaces: excluded, imageUploads, failures, indexFailures }, null, 2));
console.log(`${stored}/${images.length} images + metadata stored. ${analyzed} visual captions complete; ${images.length - analyzed} pending. No AI quota or billing changes attempted.`);
if (failures.length || indexFailures.length) process.exitCode = 1;
