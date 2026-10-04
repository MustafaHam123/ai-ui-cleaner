import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { normalizeImportedRecord } from "../src/ingestion.js";
import type { ReferenceRecord } from "../src/schema.js";

type Json = Record<string, unknown>;
function object(value: unknown): Json { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object"); return value as Json; }
const str = (value: unknown) => typeof value === "string" ? value.trim() : "";
const idFor = (value: string) => `export-${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

export function normalizeExport(entry: unknown, sourceName: string): ReferenceRecord {
  const raw = object(entry);
  if (raw.implementation && raw.source && raw.id) return normalizeImportedRecord(raw);
  const url = str(raw.url || raw.sourceUrl || raw.link);
  const title = str(raw.title || raw.name);
  const summary = str(raw.description || raw.summary);
  if (!url || title.length < 2 || summary.length < 10) throw new Error("Export requires a real title, source URL, and short description; missing content is not fabricated");
  const tags = list(raw.tags);
  const fragments = [str(raw.html), str(raw.css), str(raw.js)].filter(Boolean);
  const code = str(raw.code) || fragments.join("\n\n");
  const implementation = raw.implementation ?? {
    approach: "Use this source as evidence for behavior and hierarchy. Identify the relevant task, then recreate that principle using the project's own components and tokens.",
    steps: ["Identify what each element does and which content has priority.", "Translate the useful relationship into the target framework; implement actual interaction states rather than copying decorative markup.", "Replace all source-specific content and assets with the user's supplied material."],
    responsive: ["Derive narrow-screen reading order from the task and test real content wrapping."],
    accessibility: ["Preserve semantic structure, keyboard operation, visible focus, and reduced-motion behavior."],
    adaptation: ["Do not reproduce the complete source composition, branding, text, imagery, or ornamental conventions. Strengthen these generic notes with curator-written pattern-specific steps before using this as a primary reference."],
  };
  return normalizeImportedRecord({
    id: idFor(url), title, summary, source: { name: sourceName, url, author: str(raw.author) || undefined, capturedAt: new Date().toISOString() },
    kind: code ? "code-component" : "visual-reference", implementation, usage: "reference-only", tags,
    whyItWorks: list(raw.whyItWorks).length ? raw.whyItWorks : ["A source-grounded example provides evidence for the named interaction or composition; verify its suitability against the current brief."],
    avoidWhen: ["The source does not explain the user's actual task or requires copying identity or assets."], components: list(raw.components), technologies: list(raw.technologies),
    license: { reuseAllowed: false, notes: "Imported as reference-only. Review the source license independently before enabling code reuse." },
    assets: raw.assets ?? [], code: code ? { language: fragments.length ? "html-css-javascript" : str(raw.language) || "text", content: code, dependencies: list(raw.dependencies), reviewStatus: "unreviewed" } : undefined,
    curatorNotes: "Imported export, not a live source crawl. Generic implementation guidance requires curation before high-confidence use. Scraped code has not been executed.",
  });
}

export function normalizeFigmaExport(value: unknown, fileKey: string, nodeIds: string[]): ReferenceRecord[] {
  const raw = object(value);
  const nodes = raw.nodes ? object(raw.nodes) : undefined;
  const find = (value: unknown, id: string): Json | undefined => {
    const node = object(value);
    if (node.id === id) return node;
    for (const child of Array.isArray(node.children) ? node.children : []) { const found = find(child, id); if (found) return found; }
    return undefined;
  };
  return nodeIds.map(id => {
    const node = nodes ? object(object(nodes[id]).document) : find(raw.document ?? raw, id);
    if (!node) throw new Error(`Selected Figma node missing: ${id}`);
    const title = str(node.name); const mode = str(node.layoutMode);
    const spacing = typeof node.itemSpacing === "number" ? node.itemSpacing : undefined;
    const children = Array.isArray(node.children) ? node.children.map(object) : [];
    const url = `https://www.figma.com/design/${encodeURIComponent(fileKey)}?node-id=${encodeURIComponent(id)}`;
    return normalizeImportedRecord({
      id: idFor(url), title, source: { name: "Figma", url, capturedAt: new Date().toISOString() }, kind: "page-pattern", usage: "reference-only",
      summary: `Selected ${str(node.type).toLowerCase()} '${title}' with ${children.length} immediate elements${mode ? ` and ${mode.toLowerCase()} auto-layout` : ""}.`,
      implementation: {
        approach: "Study the selected frame's hierarchy and layout constraints, then map its useful relationships to the user's actual content and existing design system.",
        steps: [mode && mode !== "NONE" ? `Translate ${mode.toLowerCase()} auto-layout into an appropriate flex or grid flow; do not replicate absolute canvas coordinates.` : "Inspect alignment and constraints before choosing normal document flow or a constrained composition.", ...(spacing === undefined ? [] : [`Observed item spacing is ${spacing} canvas units; map it to an existing project spacing token instead of hardcoding source measurements.`]), `Inspect the roles of immediate children: ${children.slice(0, 6).map(c => str(c.type).toLowerCase()).join(", ") || "none"}. Do not preserve placeholder text or branding.`],
        responsive: ["Derive reflow from constraints and reading order. A fixed desktop frame alone does not establish mobile behavior."],
        accessibility: ["Convert visually implied controls into semantic controls and verify focus, contrast, labels, and reading order in the implemented UI."],
        adaptation: ["Use proportions, relationships, and interaction ideas as evidence. Do not copy the source frame wholesale unless the user explicitly requests faithful implementation and has rights to it."],
      }, whyItWorks: ["Explicit frame structure exposes grouping and content hierarchy instead of relying on a style label."], avoidWhen: ["The frame is unrelated to the user's actual task or its mobile behavior is unknown."],
      components: [...new Set(children.map(c => str(c.type).toLowerCase()))].filter(Boolean), technologies: [], tags: ["figma-export", "selected-frame"],
      license: { reuseAllowed: false, notes: "Selected Figma export. File access does not establish permission to redistribute designs or assets." }, assets: [],
      curatorNotes: "Frame metadata was imported from a selected export. No pixels were inspected; add a frame image asset before making visual claims.",
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npm run corpus:import -- export.json --source CodePen | --figma-file KEY --nodes 1:2,3:4");
  const text = await readFile(input, "utf8");
  const json: unknown = /\.(jsonl|ndjson)$/.test(input) ? text.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : JSON.parse(text);
  const option = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
  const fileKey = option("--figma-file");
  const source = option("--source");
  if (!fileKey && !source) throw new Error("Specify the export's actual source with --source");
  const records = fileKey ? normalizeFigmaExport(json, fileKey, (option("--nodes") ?? "").split(",").filter(Boolean)) : (Array.isArray(json) ? json : Array.isArray(object(json).items) ? object(json).items as unknown[] : [json]).map(r => normalizeExport(r, source!));
  if (!records.length) throw new Error("No selected records. Figma imports require explicit --nodes IDs");
  const output = path.resolve("data/local/imported.jsonl");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, records.map(r => JSON.stringify(r)).join("\n") + "\n");
  console.log(`${records.length} normalized records in ${output}. Merge with: npm run ingest -- ${output}`);
}
