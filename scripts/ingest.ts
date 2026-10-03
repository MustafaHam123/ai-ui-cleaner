import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { normalizeImportedRecord } from "../src/ingestion.js";
import type { ReferenceRecord } from "../src/schema.js";

function usage(): never {
  console.error("Usage: npm run ingest -- <input.json|input.jsonl> [--output path] [--replace] [--preserve-review-status]");
  process.exit(2);
}

function parseArguments(args: string[]) {
  const input = args.find((arg) => !arg.startsWith("--"));
  if (!input) usage();
  const outputIndex = args.indexOf("--output");
  const output = outputIndex >= 0 ? args[outputIndex + 1] : "data/local/references.jsonl";
  if (!output) usage();
  return {
    input: path.resolve(input),
    output: path.resolve(output),
    replace: args.includes("--replace"),
    preserveReviewStatus: args.includes("--preserve-review-status"),
  };
}

function parseInput(text: string, filePath: string): unknown[] {
  if (filePath.endsWith(".jsonl") || filePath.endsWith(".ndjson")) {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON at ${filePath}:${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
  const parsed = JSON.parse(text) as unknown;
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function existingRecords(filePath: string): Promise<ReferenceRecord[]> {
  try {
    const text = await readFile(filePath, "utf8");
    return parseInput(text, filePath).map((record) => normalizeImportedRecord(record, true));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

const options = parseArguments(process.argv.slice(2));
const imported = parseInput(await readFile(options.input, "utf8"), options.input)
  .map((record) => normalizeImportedRecord(record, options.preserveReviewStatus));
const records = options.replace ? new Map<string, ReferenceRecord>() : new Map((await existingRecords(options.output)).map((record) => [record.id, record]));
for (const record of imported) records.set(record.id, record);

await mkdir(path.dirname(options.output), { recursive: true });
await writeFile(options.output, `${[...records.values()].map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
console.log(`Imported ${imported.length} references; ${records.size} total in ${options.output}`);
