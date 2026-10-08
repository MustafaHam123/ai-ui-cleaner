import type { ReferenceRecord, referenceAssetSchema } from "./schema.js";
import type { SearchHit, SearchOptions } from "./retrieval.js";
import type { z } from "zod/v4";

export interface CorpusStats {
  total: number;
  sources: Record<string, number>;
  kinds: Record<string, number>;
  reusableCodeAssets: number;
  visualAssets: number;
  backend: string;
  indexedChunks?: number;
  dataPaths?: readonly string[];
}

export interface ReferenceRepository {
  search(options: SearchOptions): Promise<SearchHit[]>;
  get(id: string): Promise<ReferenceRecord | undefined>;
  stats(): Promise<CorpusStats>;
}

export interface AssetBytes { bytes: Uint8Array; mediaType: string }
export interface ServerOptions {
  assetHosts?: string[];
  maxAssetBytes?: number;
  readAsset?: (asset: z.infer<typeof referenceAssetSchema>) => Promise<AssetBytes>;
  assetUrl?: (referenceId: string, assetId: string) => string;
}

export function summarizeRecords(records: ReferenceRecord[], backend: string): CorpusStats {
  const countBy = (select: (record: ReferenceRecord) => string) => {
    const counts: Record<string, number> = {};
    for (const record of records) counts[select(record)] = (counts[select(record)] ?? 0) + 1;
    return counts;
  };
  return {
    total: records.length, sources: countBy(r => r.source.name), kinds: countBy(r => r.kind), backend,
    reusableCodeAssets: records.filter(r => r.code?.reviewStatus === "reviewed" && r.license.reuseAllowed).length,
    visualAssets: records.reduce((n, r) => n + r.assets.length, 0),
  };
}
