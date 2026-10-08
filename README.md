# AI UI Cleaner

AI UI Cleaner is a reference-grounded interface creation, review, and repair plugin for GPT/Codex-compatible hosts and Claude Code. It combines:

- A portable Agent Skill that directs Figma and code-based creation, redesign, implementation, and system-level review.
- An MCP server exposing focused reference-search tools.
- A local-first hybrid RAG layer with keyword relevance, hashed-vector similarity, metadata boosts, filtering, and diversity reranking.
- Conservative provenance and code-reuse gates.

The committed seed records are original abstract design patterns. Harvested reference data, code, source snapshots, and preview images belong outside Git. The Cloudflare backend and bounded collector are implemented; see [the cloud corpus setup](docs/cloudflare.md) for deployment, existing collection coverage, and imports.

For a shared public library, the owner runs `npm run cloud:setup` after one browser login. This creates a dedicated `ai-ui-cleaner-corpus` R2 bucket, D1 database and semantic search index, deploys the MCP on workers.dev only, and automatically uploads the existing corpus. It never uses `quran-mode-assets` or binds existing websites/domains. Installers need only the public MCP URL, not the owner's Cloudflare credentials. See the cloud guide for quota limits and verification.

## Quick start

The plugin's MCP configurations connect to the shared public library at `https://ai-ui-cleaner.ai-ui-cleaner.workers.dev/mcp`. Installers do not need Node, Cloudflare login, database downloads, or API keys for that connection. The commands below are for local development, not required for the hosted plugin.

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
- `.claude-plugin/marketplace.json` is the shared desktop-install catalog (Claude format, also supported by Codex).
- Both plugin manifests connect directly to the hosted public MCP. The committed `dist/index.cjs` remains available for local development or stdio-only hosts; rebuild it whenever server source changes.

### Install in desktop apps (skill + MCP together)

See [desktop installation](docs/desktop-install.md). The plugin installer downloads the skill from this GitHub repository and connects its bundled MCP configuration to Cloudflare. Adding the MCP URL alone does **not** download the skill. The reference database and images stay on Cloudflare, outside the plugin download.

### Connect only the running public MCP

Nothing needs to run locally for the hosted corpus. Use the full `/mcp` URL, not the homepage. No API key or OAuth login is required.

Codex CLI (also shared with compatible desktop/IDE settings):

```bash
codex mcp add ai_ui_cleaner --url https://ai-ui-cleaner.ai-ui-cleaner.workers.dev/mcp
codex mcp list
```

Claude Code:

```bash
claude mcp add --transport http --scope user ai_ui_cleaner https://ai-ui-cleaner.ai-ui-cleaner.workers.dev/mcp
claude mcp list
```

Start a new session after connecting. If the plugin already supplies this MCP, do not add a second copy. A connection adds tools, not the skill instructions: install the bundled skill/plugin too, or copy `skills/ai-ui-cleaner` into the target project's `.agents/skills/` for Codex or `.claude/skills/` for Claude Code. Invoke `$ai-ui-cleaner` in Codex or `/ai-ui-cleaner` for a standalone Claude Code skill. Plugin-installed Claude skills may have a plugin-qualified command name.

The skill first resolves the visual direction (asking when unspecified), searches visual layout terms rather than echoing product nouns, and inspects 3–5 matching screenshots. It reconstructs one primary visible frame, checks the layout, then swaps in the user's content. General web search is a fallback for a concrete coverage gap, not the primary source.

To test from chat, ask: `Use AI UI Cleaner to search for doctor appointment references, inspect two screenshots, and explain what can be adapted. Do not implement yet.` You should see `search_references`, `get_reference` and `get_reference_asset` calls. A `/mcp` URL is a protocol endpoint, so opening it as an ordinary browser page is not a connection test.

For a developer-side end-to-end check, run `npm run mcp:check` after installing dependencies. It verifies anonymous tool discovery, corpus stats, one normal search, selected metadata and its screenshot. Normal search may use a query embedding; this check does not caption images or alter the corpus.

Official setup references: [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli), [Codex skills](https://learn.chatgpt.com/docs/build-skills), [Claude Code MCP](https://code.claude.com/docs/en/mcp), and [Claude Code skills](https://code.claude.com/docs/en/skills).

Do not commit credentials to either MCP configuration.

## MCP tools

| Tool | Purpose |
|---|---|
| `search_references` | Hybrid search with design and license filters; never returns raw code. |
| `get_reference` | Retrieves one selected reference and its provenance. |
| `get_reference_asset` | Fetches one allowlisted, curated screenshot with MIME, size, redirect, and digest checks. |
| `get_code_asset` | Returns code only when reuse is licensed and curator review is complete. |
| `reference_stats` | Shows corpus coverage and reusable-code counts. |

All model-facing tools are read-only. New records are added through local ingestion or the separate authenticated cloud admin API.

## Add reference data

Prepare JSON or JSONL using [examples/reference.example.json](examples/reference.example.json), then run:

```bash
npm run ingest -- path/to/export.jsonl
```

This writes to `data/local/references.jsonl`, which is intentionally gitignored. The server reloads changed data automatically. Set `AI_UI_CLEANER_DATA_PATHS` to a platform-delimited list of other corpus files when required.

Imported code is always downgraded to `unreviewed` by default. After manually verifying source, license, dependencies, security, and attribution, a curator can set `reviewStatus` to `reviewed` and re-import with:

```bash
npm run ingest -- reviewed.jsonl --preserve-review-status
```

The following fields are important for retrieval quality:

- `pageTypes`, `industries`, `moods`, and `components`
- `summary`, `whyItWorks`, and `avoidWhen`
- `implementation`: general approach, pattern-specific steps, responsive/accessibility notes, and adaptation instructions
- `source.name`, `source.url`, author, capture date, and license
- `visualMetadata`: actual image observations, presentation type, query aliases, task fit, adaptation principles, machine-caption status, confidence and evidence gaps
- Technology and framework requirements for reusable code

Normalize exports from 21st.dev, CodePen, Figma, Dribbble, recent.design, SaaS galleries, or another permitted source into this schema. Store screenshots on controlled object storage and add their URL, dimensions, media type, alt text, and SHA-256 to `assets`. Use official APIs or authorized exports where available. Respect robots rules, terms, access controls, attribution, and asset/code licenses; a publicly viewable page does not automatically permit republication or code reuse.

## Production corpus architecture

Do **not** commit the full database, screenshots, generated embeddings, or scraped code archives to GitHub. Keep the repository limited to application code, the skill, schemas, migrations, small original seed records, and test fixtures.

Use this production split:

| Layer | Store | Contents |
|---|---|---|
| Repository | GitHub | MCP code, skill, schemas, migrations, tiny seeds, tests |
| Metadata and retrieval | Cloudflare D1 + Vectorize (implemented) | Reference metadata, normalized text, tags, license state, embeddings, searchable reviewed-code chunks |
| Binary assets | Cloudflare R2 (implemented) | Preview images, Figma exports, permitted snapshots, license notices |
| Ingestion workers | Job runner or queue | Authorized fetching, screenshot capture, normalization, deduplication, embeddings, license review |
| MCP runtime | Container or serverless service | Search, record retrieval, signed asset access, and code-license enforcement |

The normal flow is:

```text
authorized source/export
        ↓
ingestion worker → object storage for images and archives
        ↓
normalized metadata + embeddings → database/search index
        ↓
MCP tools → selected records, screenshots, and reviewed code
        ↓
AI UI Cleaner skill → design or review workflow
```

Object-storage URLs should use a controlled hostname listed in `AI_UI_CLEANER_ASSET_HOSTS`. Prefer short-lived signed URLs for private assets. Do not use Git LFS as the primary corpus: it helps with a few large versioned fixtures, but a growing retrieval database still makes clones, history, updates, and queries inefficient.

## Retrieval behavior

The built-in retriever requires no embedding API key. It combines BM25-style term scoring with a deterministic hashed token/trigram vector, then applies explicit metadata boosts and source/type diversity penalties. This is suitable for local development and predictable testing.

The Cloudflare backend uses D1 FTS5 plus Workers AI embeddings and Vectorize, with rank fusion and source/type diversity. For a stdio-only host, set `AI_UI_CLEANER_CLOUD_URL` to make the bundled server forward to the hosted corpus. The public deployment needs no read token; `MCP_READ_TOKEN` is only for private deployments. Local emulation runs FTS5 without the semantic service. See [deployment and testing](docs/cloudflare.md).

For image references, direct assistant inspection or Cloudflare AI produces image-specific descriptive metadata with accurate captioner attribution. Descriptions support keyword retrieval and, when separately enabled, semantic embeddings; captioning alone does not generate embeddings. This is not training a new model or searching pixels directly. Search cards are concise, selected records carry full guidance, and the skill requires viewing the actual image. Machine captions remain distinct from curator review and never establish a content reuse license.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `MCP_TRANSPORT` | `stdio` | Set to `http` for streamable HTTP. |
| `MCP_HOST` | `127.0.0.1` | HTTP bind address; containers usually use `0.0.0.0`. |
| `MCP_ALLOWED_HOSTS` | localhost validation | Optional comma-separated HTTP Host allowlist. |
| `PORT` | `3000` | HTTP listening port. |
| `AI_UI_CLEANER_DATA_PATHS` | seed + local JSONL | Platform-delimited local corpus paths. |
| `AI_UI_CLEANER_ASSET_HOSTS` | none | Comma-separated hostnames permitted for screenshot retrieval. |
| `AI_UI_CLEANER_MAX_ASSET_BYTES` | `8388608` | Maximum fetched screenshot size. |

## Security model

- External narrative fields are plain text, HTML-stripped, and checked for common prompt-injection phrases during ingestion.
- Source URLs are restricted to HTTP and HTTPS.
- Raw code never appears in ordinary search or reference results.
- `get_code_asset` requires both `license.reuseAllowed: true` and `reviewStatus: reviewed`.
- Scraped code is never executed by ingestion or retrieval.
- MCP results explicitly tell the model to treat retrieved content as untrusted evidence.
