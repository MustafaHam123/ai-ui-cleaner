import type { ReferenceKind, ReferenceRecord } from "./schema.js";
import { cosineSimilarity, hashedVector, normalizeText, tokenize } from "./text.js";

export interface SearchFilters {
  pageType?: string;
  industry?: string;
  mood?: string;
  components?: string[];
  technologies?: string[];
  sources?: string[];
  kinds?: ReferenceKind[];
  licenseOnly?: boolean;
}

export interface SearchOptions extends SearchFilters {
  query: string;
  limit?: number;
}

export interface SearchHit {
  record: ReferenceRecord;
  score: number;
  matchedTerms: string[];
  reasons: string[];
}

interface IndexedRecord {
  record: ReferenceRecord;
  text: string;
  terms: string[];
  termCounts: Map<string, number>;
  vector: Float64Array;
}

export function recordText(record: ReferenceRecord): string {
  if (record.sourceMetadata) {
    return [record.title, record.sourceMetadata.sourceDescription ?? "", ...record.sourceMetadata.queryAliases].join(" ");
  }
  if (record.visualMetadata) {
    // Keep discovery centered on the individual image. Repeated safety and
    // workflow boilerplate belongs in get_reference, not every embedding.
    const visual = record.visualMetadata;
    return [record.title, visual.visibleDescription, visual.layout,
      ...visual.palette, visual.typography, visual.imagery,
      ...record.pageTypes, ...record.industries, ...record.components, ...record.moods,
      ...visual.queryAliases, ...visual.useWhen, ...visual.transferablePrinciples,
      record.implementation?.approach ?? "", ...(record.implementation?.steps ?? []),
    ].join(" ");
  }
  return [
    record.title,
    record.summary,
    record.implementation?.approach ?? "",
    ...(record.implementation?.steps ?? []),
    ...(record.implementation?.responsive ?? []),
    ...(record.implementation?.accessibility ?? []),
    ...(record.implementation?.adaptation ?? []),
    ...record.whyItWorks,
    ...record.avoidWhen,
    ...record.pageTypes,
    ...record.industries,
    ...record.moods,
    ...record.components,
    ...record.technologies,
    ...record.tags,
    record.source.name,
  ].join(" ");
}

function includesNormalized(values: string[], target?: string): boolean {
  if (!target) return true;
  const wanted = normalizeText(target);
  return values.some((value) => normalizeText(value) === wanted);
}

function intersectsNormalized(values: string[], targets?: string[]): boolean {
  if (!targets?.length) return true;
  const haystack = new Set(values.map(normalizeText));
  return targets.some((target) => haystack.has(normalizeText(target)));
}

function passesFilters(record: ReferenceRecord, filters: SearchFilters): boolean {
  if (record.tags.includes("exclude-from-ui-search")) return false;
  if (!includesNormalized(record.pageTypes, filters.pageType)) return false;
  if (!includesNormalized(record.industries, filters.industry)) return false;
  if (!includesNormalized(record.moods, filters.mood)) return false;
  if (!intersectsNormalized(record.components, filters.components)) return false;
  if (!intersectsNormalized(record.technologies, filters.technologies)) return false;
  if (!intersectsNormalized([record.source.name], filters.sources)) return false;
  if (filters.kinds?.length && !filters.kinds.includes(record.kind)) return false;
  if (filters.licenseOnly && !record.license.reuseAllowed) return false;
  return true;
}

function metadataBoost(record: ReferenceRecord, options: SearchOptions): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const add = (condition: boolean, points: number, reason: string) => {
    if (condition) {
      score += points;
      reasons.push(reason);
    }
  };

  add(Boolean(options.pageType && includesNormalized(record.pageTypes, options.pageType)), 0.12, `page type: ${options.pageType}`);
  add(Boolean(options.industry && includesNormalized(record.industries, options.industry)), 0.1, `industry: ${options.industry}`);
  add(Boolean(options.mood && includesNormalized(record.moods, options.mood)), 0.08, `mood: ${options.mood}`);

  for (const component of options.components ?? []) {
    add(includesNormalized(record.components, component), 0.04, `component: ${component}`);
  }
  for (const technology of options.technologies ?? []) {
    add(includesNormalized(record.technologies, technology), 0.03, `technology: ${technology}`);
  }
  return { score, reasons };
}

export class HybridRetriever {
  private readonly index: IndexedRecord[];
  private readonly documentFrequency = new Map<string, number>();
  private readonly averageLength: number;

  constructor(records: ReferenceRecord[]) {
    this.index = records.map((record) => {
      const text = recordText(record);
      const terms = tokenize(text);
      const termCounts = new Map<string, number>();
      for (const term of terms) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
      for (const term of new Set(terms)) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1);
      }
      return { record, text, terms, termCounts, vector: hashedVector(text) };
    });
    this.averageLength = this.index.length
      ? this.index.reduce((sum, item) => sum + item.terms.length, 0) / this.index.length
      : 1;
  }

  search(options: SearchOptions): SearchHit[] {
    const queryTerms = [...new Set(tokenize(options.query))];
    const queryVector = hashedVector(options.query);
    const candidates = this.index
      .filter(({ record }) => passesFilters(record, options))
      .map((item) => {
        const bm25 = this.bm25(item, queryTerms);
        const vector = cosineSimilarity(queryVector, item.vector);
        const metadata = metadataBoost(item.record, options);
        const matchedTerms = queryTerms.filter((term) => item.termCounts.has(term));
        const exactPhrase = normalizeText(item.text).includes(normalizeText(options.query)) ? 0.08 : 0;
        return {
          record: item.record,
          score: bm25 * 0.54 + vector * 0.28 + metadata.score + exactPhrase,
          matchedTerms,
          reasons: metadata.reasons,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((left, right) => right.score - left.score);

    return this.diversify(candidates, Math.min(Math.max(options.limit ?? 6, 1), 12));
  }

  private bm25(item: IndexedRecord, queryTerms: string[]): number {
    if (!queryTerms.length || !this.index.length) return 0;
    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    for (const term of queryTerms) {
      const frequency = item.termCounts.get(term) ?? 0;
      if (!frequency) continue;
      const df = this.documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (this.index.length - df + 0.5) / (df + 0.5));
      const denominator = frequency + k1 * (1 - b + b * (item.terms.length / this.averageLength));
      score += idf * ((frequency * (k1 + 1)) / denominator);
    }
    return score / Math.max(queryTerms.length, 1);
  }

  private diversify(candidates: SearchHit[], limit: number): SearchHit[] {
    const selected: SearchHit[] = [];
    const remaining = [...candidates];
    while (selected.length < limit && remaining.length) {
      let bestIndex = 0;
      let bestAdjusted = Number.NEGATIVE_INFINITY;
      for (let index = 0; index < remaining.length; index += 1) {
        const candidate = remaining[index];
        const sameSource = selected.filter((hit) => hit.record.source.name === candidate.record.source.name).length;
        const sameKind = selected.filter((hit) => hit.record.kind === candidate.record.kind).length;
        const adjusted = candidate.score - sameSource * 0.1 - sameKind * 0.035;
        if (adjusted > bestAdjusted) {
          bestAdjusted = adjusted;
          bestIndex = index;
        }
      }
      selected.push(remaining.splice(bestIndex, 1)[0]);
    }
    return selected;
  }
}
