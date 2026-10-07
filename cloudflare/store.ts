import type { D1Database, D1PreparedStatement, R2Bucket, VectorizeIndex, VectorizeVectorMetadataFilter, Ai } from "@cloudflare/workers-types";
import { parseReferenceRecord, type ReferenceRecord } from "../src/schema.js";
import { recordText, type SearchHit, type SearchOptions } from "../src/retrieval.js";
import { tokenize } from "../src/text.js";
import type { CorpusStats, ReferenceRepository } from "../src/repository.js";

export interface Env {
  DB: D1Database;
  ASSETS: R2Bucket;
  VECTORS?: VectorizeIndex;
  AI?: Ai;
  ADMIN_TOKEN?: string;
  MCP_READ_TOKEN?: string;
  PUBLIC_MCP?: string;
  MCP_RATE_LIMIT?: { limit(options: { key: string }): Promise<{ success: boolean }> };
  ASSET_HOSTS?: string;
}
export const EMBEDDING_MODEL = "@cf/baai/bge-base-en-v1.5";
const visibleSql = (alias = "r") => `NOT EXISTS(SELECT 1 FROM json_each(${alias}.record_json, '$.tags') excluded WHERE excluded.value = 'exclude-from-ui-search')`;

export async function makeChunks(record: ReferenceRecord) {
  const text = recordText(record) + (record.code?.reviewStatus === "reviewed" && record.license.reuseAllowed ? `\nReviewed ${record.code.language} implementation reference:\n${record.code.content}` : "");
  const prefix = `${record.title}. ${record.source.name}. ${record.kind}. `;
  const chunks: Array<{ id: string; referenceId: string; content: string }> = [];
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(record.id));
  const key = [...new Uint8Array(digest)].map(v => v.toString(16).padStart(2, "0")).join("").slice(0, 40);
  for (let offset = 0; offset < text.length; offset += 1100) {
    chunks.push({ id: `${key}:${chunks.length}`, referenceId: record.id, content: prefix + text.slice(offset, offset + 1300) });
  }
  return chunks;
}

function filterSql(options: SearchOptions, alias = "r") {
  const clauses: string[] = [visibleSql(alias)];
  const values: (string | number)[] = [];
  for (const [field, targets] of Object.entries({ pageTypes: options.pageType ? [options.pageType] : [], industries: options.industry ? [options.industry] : [], moods: options.mood ? [options.mood] : [], components: options.components, technologies: options.technologies })) {
    if (!targets?.length) continue;
    clauses.push(`EXISTS(SELECT 1 FROM json_each(${alias}.record_json, '$.${field}') j WHERE lower(j.value) IN (${targets.map(() => "?").join(",")}))`);
    values.push(...targets.map(t => t.trim().toLowerCase()));
  }
  for (const [field, targets] of [["source", options.sources], ["kind", options.kinds]] as const) {
    if (!targets?.length) continue;
    clauses.push(`lower(${alias}.${field}) IN (${targets.map(() => "?").join(",")})`);
    values.push(...targets.map(t => t.trim().toLowerCase()));
  }
  if (options.licenseOnly) clauses.push(`${alias}.reuse_allowed = 1`);
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", values };
}

export class CloudflareStore implements ReferenceRepository {
  constructor(private env: Env) {}

  async get(id: string): Promise<ReferenceRecord | undefined> {
    const row = await this.env.DB.prepare(`SELECT record_json FROM ui_references r WHERE id = ? AND ${visibleSql()}`).bind(id).first<{ record_json: string }>();
    return row ? parseReferenceRecord(JSON.parse(row.record_json)) : undefined;
  }

  async stats(): Promise<CorpusStats> {
    const [totals, sources, kinds, chunks] = await Promise.all([
      this.env.DB.prepare(`SELECT count(*) total, coalesce(sum(asset_count),0) visualAssets, coalesce(sum(reuse_allowed = 1 AND code_review = 'reviewed'),0) reusableCodeAssets FROM ui_references r WHERE ${visibleSql()}`).first<{ total: number; visualAssets: number; reusableCodeAssets: number }>(),
      this.env.DB.prepare(`SELECT source label, count(*) count FROM ui_references r WHERE ${visibleSql()} GROUP BY source`).all<{ label: string; count: number }>(),
      this.env.DB.prepare(`SELECT kind label, count(*) count FROM ui_references r WHERE ${visibleSql()} GROUP BY kind`).all<{ label: string; count: number }>(),
      this.env.DB.prepare(`SELECT count(*) count FROM reference_chunks c JOIN ui_references r ON r.id=c.reference_id WHERE vector_indexed = 1 AND ${visibleSql()}`).first<{ count: number }>(),
    ]);
    return { total: totals?.total ?? 0, visualAssets: totals?.visualAssets ?? 0, reusableCodeAssets: totals?.reusableCodeAssets ?? 0,
      sources: Object.fromEntries(sources.results.map(r => [r.label, r.count])), kinds: Object.fromEntries(kinds.results.map(r => [r.label, r.count])),
      backend: this.env.VECTORS && this.env.AI ? "cloudflare-d1-vectorize-r2" : "cloudflare-d1-fts5-r2", indexedChunks: chunks?.count ?? 0 };
  }

  async search(options: SearchOptions): Promise<SearchHit[]> {
    const terms = [...new Set(tokenize(options.query))].slice(0, 30);
    if (!terms.length) return [];
    const filter = filterSql(options);
    const query = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const lexical = await this.env.DB.prepare(`SELECT c.id, c.reference_id, r.record_json FROM chunks_fts f JOIN reference_chunks c ON c.rowid = f.rowid JOIN ui_references r ON r.id = c.reference_id WHERE chunks_fts MATCH ? ${filter.sql} ORDER BY bm25(chunks_fts) LIMIT 80`).bind(query, ...filter.values).all<{ id: string; reference_id: string; record_json: string }>();
    const fused = new Map<string, { record: ReferenceRecord; score: number; reasons: string[] }>();
    const merge = (record: ReferenceRecord, rank: number, reason: string, weight = 1) => {
      const prior = fused.get(record.id);
      if (prior) { prior.score += weight / (60 + rank); if (!prior.reasons.includes(reason)) prior.reasons.push(reason); }
      else fused.set(record.id, { record, score: weight / (60 + rank), reasons: [reason] });
    };
    // Multiple matching chunks from one reference must not inflate its ranking.
    const seen = new Set<string>();
    for (const row of lexical.results) {
      if (seen.has(row.reference_id)) continue;
      const record = parseReferenceRecord(JSON.parse(row.record_json));
      // Don't turn a match inside generic guidance or a CSS pseudo-element
      // into a supposed design reference. Keyword hits need task-specific
      // evidence; semantic retrieval can still find paraphrased concepts.
      const anchors = new Set(tokenize([record.title, record.summary, ...record.components, ...record.tags, ...(record.visualMetadata?.queryAliases ?? []), ...(record.implementation?.steps ?? [])].join(" ")));
      if (!terms.some(term => anchors.has(term))) continue;
      seen.add(row.reference_id);
      merge(record, seen.size, "D1 FTS5 task-specific keyword match");
    }
    if (this.env.AI && this.env.VECTORS) {
      try {
        const result = await this.env.AI.run(EMBEDDING_MODEL, { text: [options.query] }) as { data: number[][] };
        const vectorFilter: VectorizeVectorMetadataFilter = {};
        if (options.licenseOnly) vectorFilter.reuseAllowed = true;
        if (options.kinds?.length) vectorFilter.kind = { $in: options.kinds };
        if (options.sources?.length) vectorFilter.source = { $in: options.sources };
        const matches = await this.env.VECTORS.query(result.data[0], { topK: 80, returnMetadata: "none", ...(Object.keys(vectorFilter).length ? { filter: vectorFilter } : {}) });
        if (matches.matches.length) {
          const ids = matches.matches.map(m => m.id);
          const rows = await this.env.DB.prepare(`SELECT c.id, r.record_json FROM reference_chunks c JOIN ui_references r ON r.id=c.reference_id WHERE c.vector_indexed=1 AND c.id IN (${ids.map(() => "?").join(",")}) ${filter.sql}`).bind(...ids, ...filter.values).all<{ id: string; record_json: string }>();
          const byId = new Map(rows.results.map(r => [r.id, r.record_json]));
          const semanticSeen = new Set<string>();
          for (let rank = 0; rank < matches.matches.length; rank++) {
            const json = byId.get(matches.matches[rank].id);
            if (!json) continue;
            const record = parseReferenceRecord(JSON.parse(json));
            if (semanticSeen.has(record.id)) continue;
            semanticSeen.add(record.id); merge(record, rank + 1, "Vectorize semantic match", 1.2);
          }
        }
      } catch (error) {
        console.error("Semantic retrieval unavailable; returning FTS5 results", error instanceof Error ? error.message : String(error));
        for (const item of fused.values()) item.reasons.push("Semantic service unavailable; keyword fallback");
      }
    }
    const pool = [...fused.values()];
    const selected: SearchHit[] = [];
    while (pool.length && selected.length < (options.limit ?? 6)) {
      pool.sort((a, b) => {
        const penalty = (r: ReferenceRecord) => selected.filter(s => s.record.source.name === r.source.name).length * .003 + selected.filter(s => s.record.kind === r.kind).length * .001;
        return (b.score - penalty(b.record)) - (a.score - penalty(a.record));
      });
      const hit = pool.shift()!;
      const haystack = tokenize(recordText(hit.record));
      selected.push({ ...hit, matchedTerms: terms.filter(t => haystack.includes(t)) });
    }
    return selected;
  }

  async upsert(record: ReferenceRecord, indexSemantic = true) {
    const chunks = await makeChunks(record);
    const old = await this.env.DB.prepare("SELECT id FROM reference_chunks WHERE reference_id=?").bind(record.id).all<{ id: string }>();
    const statements: D1PreparedStatement[] = [
      this.env.DB.prepare("INSERT INTO ui_references(id,title,source,kind,reuse_allowed,code_review,asset_count,record_json) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title, source=excluded.source, kind=excluded.kind, reuse_allowed=excluded.reuse_allowed, code_review=excluded.code_review, asset_count=excluded.asset_count, record_json=excluded.record_json, updated_at=CURRENT_TIMESTAMP").bind(record.id, record.title, record.source.name, record.kind, Number(record.license.reuseAllowed), record.code?.reviewStatus ?? null, record.assets.length, JSON.stringify(record)),
      this.env.DB.prepare("DELETE FROM reference_chunks WHERE reference_id=?").bind(record.id),
      ...chunks.map(c => this.env.DB.prepare("INSERT INTO reference_chunks(id,reference_id,content) VALUES(?,?,?)").bind(c.id, c.referenceId, c.content)),
    ];
    await this.env.DB.batch(statements);
    if (indexSemantic && this.env.AI && this.env.VECTORS) {
      // Stale vectors are also excluded by joining against the current D1 chunks.
      if (old.results.length) await this.env.VECTORS.deleteByIds(old.results.map(c => c.id));
      const embeddings = await this.env.AI.run(EMBEDDING_MODEL, { text: chunks.map(c => c.content) }) as { data: number[][] };
      if (embeddings.data.length !== chunks.length || embeddings.data.some(v => v.length !== 768)) throw new Error("Embedding model returned incompatible dimensions");
      await this.env.VECTORS.upsert(chunks.map((c, i) => ({ id: c.id, values: embeddings.data[i], metadata: { referenceId: record.id, kind: record.kind, source: record.source.name, reuseAllowed: record.license.reuseAllowed } })));
      await this.env.DB.batch(chunks.map(c => this.env.DB.prepare("UPDATE reference_chunks SET vector_indexed=1 WHERE id=?").bind(c.id)));
    }
    return { id: record.id, chunks: chunks.length, semanticIndexed: Boolean(indexSemantic && this.env.AI && this.env.VECTORS) };
  }

  // Reversible quarantine retains records, chunks and R2 assets without AI calls.
  async excludeFromUiSearch(id: string) {
    const row = await this.env.DB.prepare("SELECT record_json FROM ui_references WHERE id = ?").bind(id).first<{ record_json: string }>();
    if (!row) return { id, excluded: true, existed: false };
    const record = parseReferenceRecord(JSON.parse(row.record_json));
    record.tags = [...new Set([...record.tags, "exclude-from-ui-search"])];
    await this.env.DB.prepare("UPDATE ui_references SET record_json=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(JSON.stringify(record), id).run();
    return { id, excluded: true, existed: true };
  }
}
