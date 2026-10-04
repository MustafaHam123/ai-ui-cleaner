import { load } from "cheerio";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalizeImportedRecord } from "../src/ingestion.js";
import { referenceAssetSchema, type ReferenceRecord } from "../src/schema.js";
import { fetchSource } from "./collector-http.js";
import { targets, type CollectionTarget } from "./corpus-manifest.js";
import { imageSignatureMatches } from "../src/http-body.js";

export function describeTarget(target: CollectionTarget, page: string, capturedAt: string): ReferenceRecord {
  const author = page.match(/\*\*Author:\*\*\s*(.+)/)?.[1]?.trim();
  const license = page.match(/\*\*License:\*\*\s*(.+)/)?.[1]?.trim();
  return normalizeImportedRecord({
    id: target.id, title: target.title, source: { name: target.source, url: target.url.replace(/\.md$/, ""), author, capturedAt },
    kind: target.kind, summary: target.summary, usage: "reference-only",
    implementation: {
      approach: `Use the ${target.components.join(", ")} pattern only when it serves the user's content and task. Reimplement its behavior in the project's existing stack and visual system.`,
      steps: target.steps,
      responsive: ["Choose a narrow-screen arrangement from the content's reading order; keep controls readable and touch-accessible. Test wrapping with real long labels."],
      accessibility: ["Use semantic elements, visible focus, accessible names, and keyboard equivalents. Respect reduced motion and ensure state is not conveyed by color alone."],
      adaptation: ["Borrow the behavioral or hierarchy principle, not the source's branding, words, imagery, exact arrangement, or decorative treatment.", "Do not add all-caps eyebrows, section indices, stat rails, or equal cards just because a retrieved example contains them. Explicit user requirements can request these treatments."],
    },
    whyItWorks: [`${target.title} connects presentation to a specific user task rather than adding a generic decorative section.`],
    avoidWhen: [target.avoid], components: target.components, pageTypes: target.pageTypes ?? [],
    technologies: target.source === "21st.dev" || target.source === "shadcn/ui" || target.source === "Radix UI" || target.source === "Headless UI" ? ["react"] : [],
    tags: ["curated", "reference-only", ...target.components],
    license: { spdx: license === "MIT" ? "MIT" : undefined, reuseAllowed: false, notes: license ? `Source reports ${license}; imagery rights and code reuse must be verified independently.` : "Reference-only. No republication or code-reuse permission inferred from public access." },
    assets: [], curatorNotes: "Implementation guidance is curator-authored abstraction, not an instruction copied from the source. Source fetch evidence and raw page are saved in the ingestion ledger; code is never executed.",
  });
}

export async function collect(outputDirectory: string, selection = targets, refreshGuidance = false) {
  await mkdir(path.join(outputDirectory, "raw"), { recursive: true });
  await mkdir(path.join(outputDirectory, "assets"), { recursive: true });
  const corpusPath = path.join(outputDirectory, "references.jsonl");
  const records = new Map<string, ReferenceRecord>();
  try { for (const line of (await readFile(corpusPath, "utf8")).split(/\r?\n/).filter(Boolean)) { const r = normalizeImportedRecord(JSON.parse(line), true); records.set(r.id, r); } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const report: Array<Record<string, unknown>> = [];
  let recentGallery: string | undefined;
  for (const target of selection) {
    const existing = records.get(target.id);
    const capturedAt = refreshGuidance ? existing?.source.capturedAt ?? new Date().toISOString() : new Date().toISOString();
    try {
      if (refreshGuidance && !existing) throw new Error("No collected source available for offline recuration");
      const page = refreshGuidance ? { bytes: new Uint8Array(await readFile(path.join(outputDirectory, "raw", `${target.id}.txt`))), mediaType: "text/plain", url: target.url } : await fetchSource(target.url);
      const text = new TextDecoder().decode(page.bytes);
      if (/checking your browser|verify you are human|cf-chl-widget|captcha/i.test(text) || text.length < 100) throw new Error("Source is a challenge or empty page; no bypass attempted");
      const $ = load(text);
      if ($("title").text().toLowerCase().includes("404")) throw new Error("Source page reports not found");
      const record = describeTarget(target, text, capturedAt);
      await writeFile(path.join(outputDirectory, "raw", `${record.id}.txt`), page.bytes);
      const assetErrors: string[] = [];
      if (refreshGuidance) {
        record.assets = existing!.assets;
        record.code = existing!.code;
        record.license = existing!.license;
        record.curatorNotes = existing!.curatorNotes;
        if (record.code) record.implementation!.adaptation.push("Resolve source-specific import aliases and local components in the target project. Registry helpers such as cn may be local utilities, not automatically installable packages.");
      } else {
      if (target.imageSelector) {
        let imageUrl = $(target.imageSelector).first().attr("content") ?? $(target.imageSelector).first().attr("src");
        let width: number | undefined, height: number | undefined;
        // Recent's item HTML can be a client shell with the same site-wide OG
        // cover on every item. Only accept a preview actually tied to this item.
        if (target.source === "recent.design") {
          if (!recentGallery) {
            recentGallery = new TextDecoder().decode((await fetchSource("https://recent.design")).bytes);
            await writeFile(path.join(outputDirectory, "raw", "recent-gallery.txt"), recentGallery);
          }
          const gallery = load(recentGallery);
          const image = gallery(`a[href="${new URL(target.url).pathname}"]`).closest("article").find('img[src*="/items/"]').first();
          imageUrl = image.attr("src");
          width = Number(image.attr("width")) || undefined; height = Number(image.attr("height")) || undefined;
          if (!imageUrl) throw new Error("Item-specific preview not present in public gallery; no generic cover indexed");
        }
        if (imageUrl) {
          try {
            const asset = await fetchSource(new URL(imageUrl, page.url).href, 8_388_608);
            const sha256 = createHash("sha256").update(asset.bytes).digest("hex");
            const ext = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" } as Record<string, string>)[asset.mediaType];
            if (!ext) throw new Error(`Unsupported preview MIME: ${asset.mediaType}`);
            if (!imageSignatureMatches(asset.bytes, asset.mediaType)) throw new Error("Preview bytes do not match the declared image format");
            const storageKey = `assets/${record.id}-${sha256.slice(0, 16)}.${ext}`;
            await writeFile(path.join(outputDirectory, storageKey), asset.bytes);
            record.assets.push(referenceAssetSchema.parse({ id: `${record.id}-preview`, kind: "image", url: asset.url, storageKey, mediaType: asset.mediaType, sha256, width, height, alt: `Source-provided gallery preview for ${record.title}; a static poster, not an independently captured full-page screenshot.` }));
          } catch (error) { assetErrors.push(String(error)); }
        }
      }
      if (target.codeUrl && target.licenseUrl) {
        try {
          const license = new TextDecoder().decode((await fetchSource(target.licenseUrl, 100_000)).bytes);
          if (!license.includes("MIT License") || !license.includes("Permission is hereby granted")) throw new Error("Expected MIT license could not be verified");
          const code = new TextDecoder().decode((await fetchSource(target.codeUrl, 200_000)).bytes);
          const imports = [...code.matchAll(/from\s+["']([^"']+)["']/g)].map(m => m[1]);
          record.code = { language: "tsx", content: code, licenseText: license, dependencies: [...new Set(imports.filter(i => !i.startsWith(".") && !i.startsWith("@/")))], reviewStatus: "unreviewed" };
          await writeFile(path.join(outputDirectory, "raw", `${record.id}-LICENSE.txt`), license);
          record.implementation!.adaptation.push("Resolve source-specific import aliases and local components in the target project. Treat registry helpers such as cn as local utilities, not automatically installable packages.");
          record.license = { spdx: "MIT", reuseAllowed: true, notes: `Code license verified at ${target.licenseUrl}. Retain upstream attribution and license when adapting code. Preview imagery has separate rights. Code source: ${target.codeUrl}` };
        } catch (error) { assetErrors.push(String(error)); }
      }
      }
      records.set(record.id, normalizeImportedRecord(record, true));
      report.push({ id: record.id, sourceUrl: page.url, capturedAt, curatedAt: new Date().toISOString(), pageSha256: createHash("sha256").update(page.bytes).digest("hex"), status: refreshGuidance ? "recurated-from-cache" : "collected", assets: record.assets.length, code: Boolean(record.code), warnings: assetErrors });
      console.log(`Collected ${record.id} (${record.assets.length} preview, ${record.code ? "code stored for review" : "reference only"})`);
    } catch (error) {
      report.push({ id: target.id, sourceUrl: target.url, capturedAt, status: "skipped", error: String(error) });
      console.error(`Skipped ${target.id}: ${String(error)}`);
    }
    // Persist incrementally; an interrupted collection doesn't discard progress.
    await writeFile(corpusPath, [...records.values()].map(r => JSON.stringify(r)).join("\n") + "\n");
    await writeFile(path.join(outputDirectory, "collection-report.json"), JSON.stringify(report, null, 2));
    await appendFile(path.join(outputDirectory, "collection-ledger.jsonl"), JSON.stringify(report[report.length - 1]) + "\n");
  }
  console.log(`${records.size} references in ${corpusPath}. See collection-report.json for skipped sources and asset failures.`);
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sourceIndex = process.argv.indexOf("--source");
  const selected = sourceIndex >= 0 ? targets.filter(t => t.source.toLowerCase() === process.argv[sourceIndex + 1]?.toLowerCase()) : targets;
  if (!selected.length) throw new Error("No matching source in the collection manifest");
  await collect(path.resolve("data/local"), selected, process.argv.includes("--refresh-guidance"));
}
