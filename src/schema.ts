import { z } from "zod/v4";

export const referenceKindSchema = z.enum([
  "code-component",
  "page-pattern",
  "visual-reference",
  "interaction-pattern",
  "design-system",
  "case-study",
]);

export const codeAssetSchema = z.object({
  language: z.string().min(1).max(64),
  content: z.string().min(1).max(200_000),
  dependencies: z.array(z.string().max(120)).max(50).default([]),
  reviewStatus: z.enum(["unreviewed", "reviewed", "blocked"]).default("unreviewed"),
  licenseText: z.string().max(12_000).optional(),
});

export const referenceAssetSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/),
  kind: z.enum(["screenshot", "figma-frame", "image", "code-preview"]),
  url: z.string().url().optional(),
  storageKey: z.string().min(1).max(500).optional(),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]),
  alt: z.string().min(1).max(500),
  width: z.number().int().positive().max(20_000).optional(),
  height: z.number().int().positive().max(20_000).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).refine((asset) => Boolean(asset.url || asset.storageKey), "Asset requires a URL or storageKey");

export const implementationSchema = z.object({
  approach: z.string().min(10).max(1500),
  steps: z.array(z.string().min(3).max(700)).max(12).default([]),
  responsive: z.array(z.string().min(3).max(500)).max(8).default([]),
  accessibility: z.array(z.string().min(3).max(500)).max(8).default([]),
  adaptation: z.array(z.string().min(3).max(700)).min(1).max(8),
});

// Captions aid discovery; they are not curator review or proof of implementation.
export const visualMetadataSchema = z.object({
  version: z.literal(1),
  captionModel: z.string().min(1).max(150),
  captionedAt: z.string().datetime(),
  reviewStatus: z.enum(["machine-captioned", "human-reviewed"]),
  confidence: z.enum(["low", "medium", "high"]),
  presentationType: z.enum(["single-screen", "multi-screen-montage", "device-mockup", "component-study", "unclear"]),
  visibleDescription: z.string().min(20).max(1500),
  layout: z.string().min(10).max(700),
  palette: z.array(z.string().max(80)).max(8),
  typography: z.string().max(400),
  imagery: z.string().max(400),
  useWhen: z.array(z.string().min(5).max(250)).min(1).max(4),
  queryAliases: z.array(z.string().min(3).max(160)).min(2).max(8),
  transferablePrinciples: z.array(z.string().min(10).max(350)).min(1).max(4),
  limitations: z.array(z.string().min(5).max(300)).min(1).max(6),
});

export const sourceMetadataSchema = z.object({
  reviewStatus: z.literal("source-text-only"),
  descriptionEvidence: z.enum(["source-provided-alt-text", "source-url-title", "source-title"]),
  sourceTitle: z.string().max(200).optional(),
  sourceDescription: z.string().max(2000).optional(),
  queryAliases: z.array(z.string().min(3).max(160)).min(1).max(8),
  needsVisualInspection: z.literal(true),
});

export const referenceRecordSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{2,127}$/),
  title: z.string().min(2).max(200),
  source: z.object({
    name: z.string().min(1).max(100),
    url: z.string().url().optional(),
    author: z.string().max(120).optional(),
    capturedAt: z.string().datetime().optional(),
  }),
  kind: referenceKindSchema,
  summary: z.string().min(10).max(4_000),
  implementation: implementationSchema.optional(),
  visualMetadata: visualMetadataSchema.optional(),
  sourceMetadata: sourceMetadataSchema.optional(),
  usage: z.literal("reference-only").default("reference-only"),
  whyItWorks: z.array(z.string().min(3).max(500)).min(1).max(20),
  avoidWhen: z.array(z.string().min(3).max(500)).max(20).default([]),
  pageTypes: z.array(z.string().min(1).max(80)).max(30).default([]),
  industries: z.array(z.string().min(1).max(80)).max(30).default([]),
  moods: z.array(z.string().min(1).max(80)).max(30).default([]),
  components: z.array(z.string().min(1).max(80)).max(50).default([]),
  technologies: z.array(z.string().min(1).max(80)).max(30).default([]),
  tags: z.array(z.string().min(1).max(80)).max(80).default([]),
  license: z.object({
    spdx: z.string().max(80).optional(),
    reuseAllowed: z.boolean().default(false),
    notes: z.string().max(1_000).optional(),
  }),
  assets: z.array(referenceAssetSchema).max(20).default([]),
  code: codeAssetSchema.optional(),
  curatorNotes: z.string().max(4_000).optional(),
});

export type ReferenceKind = z.infer<typeof referenceKindSchema>;
export type ReferenceRecord = z.infer<typeof referenceRecordSchema>;

export function parseReferenceRecord(value: unknown): ReferenceRecord {
  return referenceRecordSchema.parse(value);
}
