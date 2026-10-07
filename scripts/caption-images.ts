import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { CAPTION_MODEL, CAPTION_PROMPT, imageReference, parseCaption, imageCaptionSchema, type CollectedImage } from "../src/image-metadata.js";
import { imageSignatureMatches } from "../src/http-body.js";

// Bounded, resumable image analysis. No site credentials, model downloads, or
// untrusted source code are executed. Cloudflare auth stays on this machine.
const root = path.resolve("data/local/dribbble");
const images = (JSON.parse(await readFile(path.join(root, "images.json"), "utf8")).images as CollectedImage[]).slice(0, 1000);
const config = JSON.parse(await readFile("wrangler.generated.json", "utf8"));
if (config.name !== "ai-ui-cleaner" || config.r2_buckets?.some((b: { bucket_name: string }) => b.bucket_name !== "ai-ui-cleaner-corpus")) throw new Error("Refusing non-corpus Cloudflare configuration");
// Wrangler refreshes an expired OAuth session during a normal read-only call.
execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "whoami"], { stdio: "pipe", env: { ...process.env, WRANGLER_SEND_METRICS: "false" } });
const credential = JSON.parse(execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token", "--json"], { encoding: "utf8" }));
const deployment = JSON.parse(await readFile("data/local/cloud-deployment.json", "utf8"));
if (deployment.origin !== "https://ai-ui-cleaner.ai-ui-cleaner.workers.dev") throw new Error("Unexpected corpus endpoint");
const secrets = JSON.parse(await readFile("data/local/cloud-secrets.json", "utf8"));
const publish = process.argv.includes("--publish");
const concurrency = Number(process.argv.find(arg => arg.startsWith("--concurrency="))?.split("=")[1] ?? 6);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("Concurrency must be between 1 and 8");
const limitArg = process.argv.find(arg => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : images.length;
if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Limit must be between 1 and 1000");
await mkdir(path.join(root, "metadata"), { recursive: true });
let next = 0, neurons = 0, stop = false, completed = 0;
const failures: Array<{ sha256: string; error: string }> = [];
const records = new Map<string, ReturnType<typeof imageReference>>();

async function request(url: string | URL, init: RequestInit) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(90_000) });
      if (response.status === 401 || response.status === 403 || response.status === 402) {
        stop = true;
        throw new Error(`Service requires authorization or plan action (${response.status}); no plan changes attempted`);
      }
      if (response.ok) return response;
      if (response.status === 429 && attempt === 2) stop = true;
      throw new Error(`Service returned HTTP ${response.status}`);
    } catch (error) {
      if (stop || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw new Error("Retry limit reached");
}

await Promise.all(Array.from({ length: concurrency }, async () => {
  while (!stop && next < Math.min(images.length, limit)) {
    const image = images[next++];
    try {
      const file = await realpath(image.localPath);
      if (!file.startsWith(root + path.sep)) throw new Error("Image path escapes corpus directory");
      const bytes = await readFile(file);
      if (bytes.length > 8_388_608 || !imageSignatureMatches(bytes, image.mediaType) || createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new Error("Image integrity check failed");
      const metadataPath = path.join(root, "metadata", `${image.sha256}.json`);
      let metadata;
      try { metadata = JSON.parse(await readFile(metadataPath, "utf8")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (metadata?.promptVersion !== 2) metadata = undefined;
      if (!metadata) {
        if (neurons > 250_000) { stop = true; throw new Error("Inference budget reached; captions saved for resume"); }
        const response = await request(`https://api.cloudflare.com/client/v4/accounts/${config.account_id}/ai/v1/chat/completions`, {
          method: "POST", headers: { authorization: `Bearer ${credential.token}`, "content-type": "application/json" },
          body: JSON.stringify({ model: CAPTION_MODEL, messages: [{ role: "user", content: [
            { type: "text", text: CAPTION_PROMPT },
            { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${bytes.toString("base64")}` } },
          ] }], max_tokens: 1400, temperature: 0.1 }),
        });
        const result = await response.json() as { choices?: Array<{ finish_reason: string; message: { content: string } }>; usage?: { neurons?: number } };
        neurons += result.usage?.neurons ?? 0;
        if (!result.choices?.[0] || result.choices[0].finish_reason === "length") throw new Error("Incomplete caption; no fabricated fallback written");
        const caption = parseCaption(result.choices[0].message.content);
        metadata = { version: 1, promptVersion: 2, imageSha256: image.sha256, sourceImageUrl: image.sourceImageUrl,
          model: CAPTION_MODEL, captionedAt: new Date().toISOString(), reviewStatus: "machine-captioned", caption };
        await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      }
      if (metadata.imageSha256 !== image.sha256 || metadata.model !== CAPTION_MODEL) throw new Error("Caption provenance does not match image/model");
      const caption = imageCaptionSchema.parse(metadata.caption);
      const sourceUrl = image.sourceUrl ?? image.sourceImageUrl;
      metadata.source = { url: sourceUrl, author: image.author };
      metadata.imageStorageKey = image.storageKey;
      metadata.usage = "reference-only";
      metadata.license = { reuseAllowed: false, notes: "No image or code reuse license verified; adapt principles rather than copying assets or branding." };
      if (publish && !metadata.assetUploadedAt) {
        const endpoint = new URL("/admin/asset", deployment.origin); endpoint.searchParams.set("key", image.storageKey);
        await request(endpoint, { method: "PUT", headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": image.mediaType }, body: bytes });
        metadata.assetUploadedAt = new Date().toISOString();
      }
      if (caption.isInterface) {
        const record = imageReference(image, caption, metadata.captionedAt);
        records.set(record.id, record);
        if (publish && (!metadata.publishedAt || metadata.publishedSourceUrl !== record.source.url)) {
          const response = await request(new URL("/admin/ingest", deployment.origin), { method: "POST", headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ record }) });
          const receipt = await response.json() as { semanticIndexed?: boolean };
          if (!receipt.semanticIndexed) throw new Error("Stored caption, but semantic indexing not confirmed");
          metadata.publishedAt = new Date().toISOString();
          metadata.publishedSourceUrl = record.source.url;
        }
      }
      if (publish && (!metadata.sidecarUploadedAt || metadata.sidecarSourceUrl !== sourceUrl)) {
        metadata.sidecarUploadedAt = new Date().toISOString();
        metadata.sidecarSourceUrl = sourceUrl;
        const endpoint = new URL("/admin/asset", deployment.origin); endpoint.searchParams.set("key", `raw/dribbble/${image.sha256}.json`);
        await request(endpoint, { method: "PUT", headers: { authorization: `Bearer ${secrets.ADMIN_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify(metadata) });
      }
      await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      completed++;
      console.log(`${completed}/${Math.min(images.length, limit)} captioned; ${records.size} UI references; ${Math.round(neurons)} inference neurons this run`);
    } catch (error) {
      failures.push({ sha256: image.sha256, error: error instanceof Error ? error.message : "Caption failed" });
      console.error(`Image ${image.sha256.slice(0, 12)} failed: ${failures.at(-1)!.error}`);
    }
  }
}));
await writeFile(path.join(root, "references.jsonl"), [...records.values()].map(r => JSON.stringify(r)).join("\n") + "\n");
await writeFile(path.join(root, "metadata-report.json"), JSON.stringify({ completedAt: new Date().toISOString(), downloaded: images.length,
  attempted: next, captioned: completed, uiReferences: records.size, failures, inferenceNeuronsThisRun: neurons,
  published: publish, stopped: stop, remainingCollectionTarget: Math.max(0, 1000 - images.length) }, null, 2));
console.log(`Finished: ${completed} image-specific captions, ${records.size} UI references, ${failures.length} failures; ${Math.max(0, 1000 - images.length)} images still needed for collection target.`);
if (failures.length || stop) process.exitCode = 1;
