import fs from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { imageCaptionSchema, imageReference, type CollectedImage } from '../src/image-metadata.js';
import { normalizeImportedRecord } from '../src/ingestion.js';

// Verification only: these MCP tools read records/images and never embed a query.
const root = 'data/local/dribbble';
const manifest = JSON.parse(await fs.readFile(`${root}/images.json`, 'utf8'));
const queue: CollectedImage[] = JSON.parse(await fs.readFile(`${root}/direct-analysis-queue.json`, 'utf8'));
const models: Record<string, number> = {};
let nonInterfaces = 0;
for (const image of manifest.images as CollectedImage[]) {
  const metadata = JSON.parse(await fs.readFile(`${root}/metadata/${image.sha256}.json`, 'utf8'));
  const caption = imageCaptionSchema.parse(metadata.caption);
  if (metadata.promptVersion !== 2 || metadata.imageSha256 !== image.sha256) throw new Error('Caption provenance mismatch');
  models[metadata.model] = (models[metadata.model] ?? 0) + 1;
  if (caption.isInterface) normalizeImportedRecord(imageReference(image, caption, metadata.captionedAt, metadata.model));
  else nonInterfaces++;
  const staged = JSON.parse(await fs.readFile(`${root}/staged-metadata/${image.sha256}.json`, 'utf8'));
  if (staged.captionedAt !== metadata.captionedAt || !staged.storedAt || staged.processing?.visualCaption !== 'complete') throw new Error('Caption not stored');
}
const publication = JSON.parse(await fs.readFile(`${root}/stage-report.json`, 'utf8'));
if (publication.failures.length || publication.indexFailures.length || publication.stored !== manifest.images.length) throw new Error('Publication incomplete');
const report: Record<string, unknown> = { completedAt: new Date().toISOString(), total: manifest.images.length,
  models, uiReferences: manifest.images.length - nonInterfaces, excludedNonInterfaces: nonInterfaces,
  remainingVisualCaptions: 0, cloudAiCallsThisRun: 0, imageUploadsThisRun: publication.imageUploads,
  publication, verification: 'Schema, provenance and every storage checkpoint validated.' };
if (process.argv.includes('--cloud')) {
  const deployment = JSON.parse(await fs.readFile('data/local/cloud-deployment.json', 'utf8'));
  if (deployment.origin !== 'https://ai-ui-cleaner.ai-ui-cleaner.workers.dev') throw new Error('Unexpected corpus origin');
  const client = new Client({ name: 'direct-caption-verification', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', deployment.origin)));
    const stats = await client.callTool({ name: 'reference_stats', arguments: {} });
    if (stats.isError) throw new Error('Cloud statistics unavailable');
    report.cloudStats = stats.structuredContent;
    const verified: string[] = [];
    for (const n of [1, 401, 793]) {
      const image = queue[n - 1];
      const id = `dribbble-${image.sha256.slice(0, 32)}`;
      const result = await client.callTool({ name: 'get_reference', arguments: { id } });
      const data = result.structuredContent as { reference?: { title: string; visualMetadata?: { captionModel: string } } };
      if (result.isError || data.reference?.visualMetadata?.captionModel !== 'codex-direct-visual-analysis') throw new Error(`Cloud metadata mismatch: ${id}`);
      verified.push(data.reference.title);
    }
    const image = queue[792];
    const preview = await client.callTool({ name: 'get_reference_asset', arguments: {
      referenceId: `dribbble-${image.sha256.slice(0, 32)}`, assetId: `image-${image.sha256.slice(0, 32)}`,
    } });
    if (preview.isError || !Array.isArray(preview.content) || !preview.content.some((item: { type?: string }) => item.type === 'image')) throw new Error('Stored preview unavailable');
    const excluded = await client.callTool({ name: 'get_reference', arguments: { id: `dribbble-${queue[1].sha256.slice(0, 32)}` } });
    if (!excluded.isError) throw new Error('Non-interface quarantine not applied');
    report.cloudVerification = { verified, imagePreview: true, nonInterfaceExcluded: true, inferenceCalls: 0 };
  } finally { await client.close(); }
}
await fs.writeFile(`${root}/direct-analysis-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
