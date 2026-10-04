import type { ReferenceRecord } from "./schema.js";
import { parseReferenceRecord } from "./schema.js";

const SUSPICIOUS = [
  /ignore (all|any|the|your)?\s*(previous|prior|earlier) instructions?/i,
  /system prompt/i,
  /developer message/i,
  /reveal (your|the) (prompt|instructions?)/i,
  /<script\b/i,
  /javascript:/i,
];

function cleanText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanList(values: unknown): unknown {
  return Array.isArray(values) ? values.map((value) => typeof value === "string" ? cleanText(value) : value) : values;
}

function assertSafeNarrative(record: ReferenceRecord): void {
  const narrative = [record.title, record.summary, ...record.whyItWorks, ...record.avoidWhen, record.curatorNotes ?? "", record.implementation ? JSON.stringify(record.implementation) : ""].join("\n");
  const match = SUSPICIOUS.find((pattern) => pattern.test(narrative));
  if (match) throw new Error(`Record ${record.id} contains suspicious instruction-like content matching ${match}`);
}

export function normalizeImportedRecord(value: unknown, preserveReviewStatus = false): ReferenceRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Reference must be a JSON object");
  const raw = value as Record<string, unknown>;
  const source = raw.source && typeof raw.source === "object" && !Array.isArray(raw.source)
    ? { ...(raw.source as Record<string, unknown>) }
    : raw.source;
  const sourceRecord = source && typeof source === "object" ? source as Record<string, unknown> : undefined;
  if (typeof sourceRecord?.url === "string") {
    const url = new URL(sourceRecord.url);
    if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error(`Unsupported source URL protocol: ${url.protocol}`);
  }

  if (Array.isArray(raw.assets)) {
    for (const asset of raw.assets) {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
      const assetUrl = (asset as Record<string, unknown>).url;
      if (typeof assetUrl !== "string") continue;
      const url = new URL(assetUrl);
      if (!new Set(["http:", "https:"]).has(url.protocol)) {
        throw new Error(`Unsupported asset URL protocol: ${url.protocol}`);
      }
    }
  }

  const code = raw.code && typeof raw.code === "object" && !Array.isArray(raw.code)
    ? {
        ...(raw.code as Record<string, unknown>),
        reviewStatus: preserveReviewStatus
          ? (raw.code as Record<string, unknown>).reviewStatus
          : "unreviewed",
      }
    : raw.code;

  const implementation = raw.implementation && typeof raw.implementation === "object" && !Array.isArray(raw.implementation)
    ? Object.fromEntries(Object.entries(raw.implementation).map(([key, entry]) => [key, typeof entry === "string" ? cleanText(entry) : cleanList(entry)]))
    : raw.implementation;

  const cleaned = {
    ...raw,
    title: typeof raw.title === "string" ? cleanText(raw.title) : raw.title,
    summary: typeof raw.summary === "string" ? cleanText(raw.summary) : raw.summary,
    implementation,
    whyItWorks: cleanList(raw.whyItWorks),
    avoidWhen: cleanList(raw.avoidWhen),
    pageTypes: cleanList(raw.pageTypes),
    industries: cleanList(raw.industries),
    moods: cleanList(raw.moods),
    components: cleanList(raw.components),
    technologies: cleanList(raw.technologies),
    tags: cleanList(raw.tags),
    curatorNotes: typeof raw.curatorNotes === "string" ? cleanText(raw.curatorNotes) : raw.curatorNotes,
    source,
    code,
  };
  const record = parseReferenceRecord(cleaned);
  assertSafeNarrative(record);
  return record;
}
