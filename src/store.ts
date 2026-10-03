import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { parseReferenceRecord, type ReferenceRecord } from "./schema.js";
import { HybridRetriever, type SearchHit, type SearchOptions } from "./retrieval.js";

function defaultPaths(): string[] {
  if (process.env.UI_FIXER_DATA_PATHS) {
    return process.env.UI_FIXER_DATA_PATHS.split(path.delimiter).filter(Boolean).map((entry) => path.resolve(entry));
  }
  return [
    path.resolve(process.cwd(), "data/references.jsonl"),
    path.resolve(process.cwd(), "data/local/references.jsonl"),
  ];
}

async function readJsonLines(filePath: string): Promise<ReferenceRecord[]> {
  try {
    const text = await readFile(filePath, "utf8");
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line, index) => {
        try {
          return parseReferenceRecord(JSON.parse(line));
        } catch (error) {
          throw new Error(`Invalid reference at ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export class ReferenceStore {
  private records: ReferenceRecord[] = [];
  private byId = new Map<string, ReferenceRecord>();
  private retriever = new HybridRetriever([]);
  private signature = "";

  constructor(private readonly paths = defaultPaths()) {}

  async initialize(): Promise<void> {
    await this.refresh(true);
  }

  async refresh(force = false): Promise<boolean> {
    const parts = await Promise.all(this.paths.map(async (filePath) => {
      try {
        const info = await stat(filePath);
        return `${filePath}:${info.mtimeMs}:${info.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${filePath}:missing`;
        throw error;
      }
    }));
    const nextSignature = parts.join("|");
    if (!force && nextSignature === this.signature) return false;

    const collections = await Promise.all(this.paths.map(readJsonLines));
    const deduplicated = new Map<string, ReferenceRecord>();
    for (const record of collections.flat()) deduplicated.set(record.id, record);
    this.records = [...deduplicated.values()];
    this.byId = deduplicated;
    this.retriever = new HybridRetriever(this.records);
    this.signature = nextSignature;
    return true;
  }

  async search(options: SearchOptions): Promise<SearchHit[]> {
    await this.refresh();
    return this.retriever.search(options);
  }

  async get(id: string): Promise<ReferenceRecord | undefined> {
    await this.refresh();
    return this.byId.get(id);
  }

  async all(): Promise<ReferenceRecord[]> {
    await this.refresh();
    return [...this.records];
  }

  get dataPaths(): readonly string[] {
    return this.paths;
  }
}
