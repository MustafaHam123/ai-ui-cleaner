# UI Fixer

UI Fixer is a reference-grounded website design plugin for GPT/Codex-compatible hosts and Claude Code. It combines:

- A portable Agent Skill that directs design, implementation, and visual review.
- An MCP server exposing focused reference-search tools.
- A local-first hybrid RAG layer with keyword relevance, hashed-vector similarity, metadata boosts, filtering, and diversity reranking.
- Conservative provenance and code-reuse gates.

The repository starts with original abstract design patterns. It does not contain copied third-party code, screenshots, or scraped catalog content.

## Quick start

```bash
npm install
npm run build
npm run check
```

Start the local stdio server:

```bash
npm start
```

Start a stateless streamable HTTP endpoint:

```bash
npm run start:http
```

The endpoint is available at `http://localhost:3000/mcp`; health information is at `http://localhost:3000/health`.

## Plugin layouts

- `plugin.json`, `mcp.json`, and `skills/` form the portable Agent Plugins package.
- `.codex-plugin/plugin.json` is the Codex compatibility manifest.
- `.claude-plugin/plugin.json` and `.mcp.json` support Claude-compatible installation.
- Both local manifests start the committed, bundled `dist/index.cjs`, so plugin installs do not need production dependencies. Run `npm run build` whenever server source changes.

For ChatGPT web usage, deploy the server in HTTP mode to a stable HTTPS endpoint and change the MCP entry to:

```json
{
  "$schema": "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  "mcpServers": {
    "ui_fixer": {
      "type": "streamable-http",
      "url": "https://your-domain.example/mcp"
    }
  }
}
```

Do not commit credentials to either MCP configuration.

## MCP tools

| Tool | Purpose |
|---|---|
| `search_references` | Hybrid search with design and license filters; never returns raw code. |
| `get_reference` | Retrieves one selected reference and its provenance. |
| `get_code_asset` | Returns code only when reuse is licensed and curator review is complete. |
| `reference_stats` | Shows corpus coverage and reusable-code counts. |

All tools are read-only. New records are added through the offline ingestion command rather than a model-facing write tool.

## Add reference data

Prepare JSON or JSONL using [examples/reference.example.json](examples/reference.example.json), then run:

```bash
npm run ingest -- path/to/export.jsonl
```

This writes to `data/local/references.jsonl`, which is intentionally gitignored. The server reloads changed data automatically. Set `UI_FIXER_DATA_PATHS` to a platform-delimited list of other corpus files when required.

Imported code is always downgraded to `unreviewed` by default. After manually verifying source, license, dependencies, security, and attribution, a curator can set `reviewStatus` to `reviewed` and re-import with:

```bash
npm run ingest -- reviewed.jsonl --preserve-review-status
```

The following fields are important for retrieval quality:

- `pageTypes`, `industries`, `moods`, and `components`
- `summary`, `whyItWorks`, and `avoidWhen`
- `source.name`, `source.url`, author, capture date, and license
- Technology and framework requirements for reusable code

Normalize exports from 21st.dev, CodePen, Figma, Dribbble, recent.design, SaaS galleries, or another permitted source into this schema. Use official APIs or authorized exports where available. Respect robots rules, terms, access controls, attribution, and asset/code licenses; a publicly viewable page does not automatically permit republication or code reuse.

## Retrieval behavior

The built-in retriever requires no embedding API key. It combines BM25-style term scoring with a deterministic hashed token/trigram vector, then applies explicit metadata boosts and source/type diversity penalties. This is suitable for local development and predictable testing.

For a larger production corpus, keep the MCP tool contract and replace `HybridRetriever` with a hosted vector/keyword index and reranker. The skill and MCP clients do not need to change.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for streamable HTTP. |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address; containers usually use `0.0.0.0`. |
| `MCP_ALLOWED_HOSTS` | localhost validation | Optional comma-separated HTTP Host allowlist. |
| `PORT` | `3000` | HTTP listening port. |
| `UI_FIXER_DATA_PATHS` | seed + local JSONL | Platform-delimited corpus paths. |

## Security model

- External narrative fields are plain text, HTML-stripped, and checked for common prompt-injection phrases during ingestion.
- Source URLs are restricted to HTTP and HTTPS.
- Raw code never appears in ordinary search or reference results.
- `get_code_asset` requires both `license.reuseAllowed: true` and `reviewStatus: reviewed`.
- Scraped code is never executed by ingestion or retrieval.
- MCP results explicitly tell the model to treat retrieved content as untrusted evidence.
