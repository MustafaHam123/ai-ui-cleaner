import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Public read-only connection test. Search may use a hosted query embedding;
// this does not caption images, ingest data, or generate corpus embeddings.
const origin = 'https://ai-ui-cleaner.ai-ui-cleaner.workers.dev';
const client = new Client({ name: 'ai-ui-cleaner-connection-check', version: '1' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin)));
  const names = (await client.listTools()).tools.map(tool => tool.name);
  for (const name of ['reference_stats', 'search_references', 'get_reference', 'get_reference_asset', 'get_code_asset']) {
    if (!names.includes(name)) throw new Error(`Missing MCP tool: ${name}`);
  }
  const stats = await client.callTool({ name: 'reference_stats', arguments: {} });
  if (stats.isError) throw new Error('Corpus statistics unavailable');
  console.log('Connected anonymously; all five tools available.');
  console.log('Corpus:', JSON.stringify(stats.structuredContent));
  const search = await client.callTool({ name: 'search_references', arguments: {
    query: 'doctor appointment mobile profile availability calendar', sources: ['Dribbble'], limit: 3,
  } });
  const data = search.structuredContent as { results?: Array<{ id: string; title: string; retrieval?: { reasons: string[] } }> };
  if (search.isError || !data.results?.length) throw new Error('Reference search returned no results');
  console.log('Search:', JSON.stringify(data.results.map(hit => ({ id: hit.id, title: hit.title, reasons: hit.retrieval?.reasons }))));
  const chosen = data.results[0];
  const detail = await client.callTool({ name: 'get_reference', arguments: { id: chosen.id } });
  const reference = (detail.structuredContent as { reference?: { assets: Array<{ id: string }>; visualMetadata?: { visibleDescription: string } } }).reference;
  if (detail.isError || !reference?.visualMetadata || !reference.assets.length) throw new Error('Selected image metadata unavailable');
  const asset = await client.callTool({ name: 'get_reference_asset', arguments: { referenceId: chosen.id, assetId: reference.assets[0].id } });
  if (asset.isError || !Array.isArray(asset.content) || !asset.content.some((item: { type?: string }) => item.type === 'image')) throw new Error('Selected screenshot unavailable');
  console.log('Passed: search → full caption/guidance → actual screenshot. No installer credentials needed.');
} finally { await client.close(); }
