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
  code: codeAssetSchema.optional(),
  curatorNotes: z.string().max(4_000).optional(),
});

export type ReferenceKind = z.infer<typeof referenceKindSchema>;
export type ReferenceRecord = z.infer<typeof referenceRecordSchema>;

export function parseReferenceRecord(value: unknown): ReferenceRecord {
  return referenceRecordSchema.parse(value);
}
