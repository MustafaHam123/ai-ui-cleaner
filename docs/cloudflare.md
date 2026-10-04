# Hosted reference corpus

The skill does not connect to a database by itself. It tells the model to call MCP tools. The MCP Worker searches the corpus, then returns only selected descriptions, guidance, images, or reviewed code. No special GPT/Claude model is trained here; RAG retrieves evidence for the model already running in the host.

| Service | Stores |
|---|---|
| D1 | Reference records, implementation guidance, license/review state, chunks, FTS5 keyword index |
| R2 | Preview images, source snapshots, license notices |
| Vectorize | Semantic text embeddings; Workers AI generates 768-dimensional BGE embeddings |

Git contains source, schemas, migrations, the skill, and the small source manifest—not the harvested corpus or embeddings. `data/local/`, `.wrangler/`, secrets, and generated account configuration are ignored.

## Current collection

The initial bounded collection has 28 references from six sources: 21st.dev (10), shadcn/ui (6), Radix UI (5), Headless UI (1), daisyUI (1), and recent.design (5). It includes five item-specific gallery posters and three MIT-licensed shadcn code assets. These are starting coverage, not a complete scrape of any catalog.

Descriptions and implementation notes are curator-authored, general principles with pattern-specific steps. A gallery poster is labeled as a poster, not a captured full-page screenshot; motion-first posters cannot establish a full page's hierarchy. Reference material should inform a new design, not supply copied branding, copy, assets, or a complete composition.

The local Cloudflare emulator uses persistent D1/FTS5 and R2. It does **not** run hosted semantic embeddings. Vectorize and Workers AI activate only after account resources are provisioned and the Worker is deployed; keyword search remains available if semantic retrieval fails. Submitted vector mutations may take time to become searchable.

Keyword candidates must also match task-specific titles, summaries, tags, components, or implementation steps. A word occurring only in generic instructions or a CSS pseudo-element does not establish relevance. Broad industry/style filters may exclude neutral functional examples; search without unnecessary filters when coverage is thin. Text embeddings do not inspect pixels—the model must actually request and view selected image assets.

## Provision and deploy in your Cloudflare account

Configure `CLOUDFLARE_API_TOKEN` locally in an ignored `.env` file or shell environment. Never paste it into chat or commit it. Set `CLOUDFLARE_ACCOUNT_ID` when more than one account is accessible. The script needs account-level D1, R2, Vectorize, Workers Scripts, and Workers AI permissions, plus account read access. R2/Workers AI may require enabling those services in your account; your account's quotas and billing apply.

```bash
npm run cloud:provision -- --deploy
```

This reuses matching named resources, creates missing resources, checks embedding dimensions, adds required metadata indexes, applies migrations, deploys the Worker, and installs separate admin/read secrets. It never deletes or recreates incompatible indexes. A partial failed provisioning/deployment can leave resources created; rerun after fixing the reported account error. Keep applied migrations immutable and append future schema migrations.

The script saves the deployment configuration in ignored `wrangler.generated.json` and the generated tokens in ignored `data/local/cloud-secrets.json` with restrictive creation permissions. Existing token files are reused. Put the generated tokens into your local environment without exposing them in logs.

Set the Worker origin printed by Wrangler as `AI_UI_CLEANER_CLOUD_URL`, and set `ADMIN_TOKEN` from the local secret file. Then upload the collected corpus:

```bash
npm run cloud:sync -- data/local/references.jsonl --preserve-review-status
```

Only use `--preserve-review-status` for an explicitly reviewed corpus. Otherwise imported code is reset to unreviewed. Uploads are bounded, redirects are rejected, and retries are limited to transient errors. `data/local/sync-report.json` records failures; upload is idempotent per reference ID. An embedding failure may leave keyword data saved; retry the failed record to complete semantic indexing.

## Point the installed MCP at the cloud

For a local stdio MCP installation, set these two variables in the MCP host's environment (or the plugin root's ignored `.env`):

```text
AI_UI_CLEANER_CLOUD_URL=https://your-deployed-worker-origin
MCP_READ_TOKEN=your-read-token
```

Run the usual `npm start`/bundled plugin server. It now forwards the same five MCP tools to the remote corpus instead of loading local JSONL. There is no fallback to a thin local corpus when cloud authentication fails. Do not pass the admin token to the model-facing MCP process.

Hosts supporting authenticated Streamable HTTP can instead connect directly to `/mcp` with `Authorization: Bearer <read-token>`. This is a bearer-token endpoint, not an OAuth authorization server; hosted clients requiring OAuth need an additional auth integration. The local stdio bridge does not require hosted OAuth support.

The workflow remains `search_references` → `get_reference` → inspect selected `get_reference_asset`/`get_code_asset` → adapt to the brief. Reading `SKILL.md` alone does not grant tool access or attach images to the model.

## Local verification

```bash
npm run cloud:migrate:local
npm run cloud:dev
```

In another terminal:

```bash
AI_UI_CLEANER_CLOUD_URL=http://127.0.0.1:8787 \
ADMIN_TOKEN=local-development-admin npm run cloud:sync
npm run check
npm run test:cloud
```

The localhost-only development configuration has obvious test tokens. Never deploy `wrangler.local.jsonc`. Integration tests run actual emulated D1/R2, MCP authentication, idempotent ingestion, image retrieval, code-review gates, semantic-outage fallback, and stdio proxy forwarding. They do not establish that a remote Cloudflare account has been deployed or that an external embedding service is available.

## Add more sources and exports

```bash
npm run corpus:collect
npm run corpus:collect -- --source 21st.dev
npm run corpus:collect -- --refresh-guidance
npm run corpus:import -- /path/to/codepen-export.json --source CodePen
npm run ingest -- data/local/imported.jsonl
```

Collection verifies robots rules, enforces public HTTPS and response-size bounds, rate-limits per origin, checks image signatures, and records skips in an append-only `collection-ledger.jsonl`. It does not bypass challenges, logins, API keys, or execute fetched code. The source manifest is deliberately bounded; expand it with actual source URLs and specific guidance, rather than downloading whole catalogs indiscriminately. `collection-report.json` summarizes the latest run. Recollection resets downloaded code to unreviewed.

`--refresh-guidance` updates descriptions, tags, and implementation notes from the manifest against cached source evidence without downloading again. It preserves existing assets and code review. The initial-corpus smoke check is `npm run cloud:smoke` (or `-- --local` for the emulator).

Generic scraper exports must contain `title`, `url`, and `description`/`summary`; optional fields include `code` or `html`/`css`/`js`, `tags`, `components`, `technologies`, `assets`, and tailored `implementation`. Missing descriptions are rejected rather than invented. Generic fallback implementation notes must be curated before a record becomes a primary design reference. The normalizer writes `data/local/imported.jsonl`; merging is a separate command.

Figma exports require an actual file key and explicitly selected node IDs:

```bash
npm run corpus:import -- /path/to/figma-export.json \
  --figma-file ACTUAL_FILE_KEY --nodes 1:2,3:4
npm run ingest -- data/local/imported.jsonl
```

This accepts Figma document or file-nodes JSON and extracts selected frame structure. It does not invent pixels or retrieve private files without access. Add an exported frame image using the asset schema. Storage-backed images live under `data/local/assets/` with matching `assets/...` keys and SHA-256 digests. The sync command uploads those files to private R2; the MCP returns selected image bytes, so no public image bucket is required.

21st's public component markdown supplies descriptions and metadata. Protected install/code endpoints need authorized API access; this collector does not bypass that. CodePen challenge pages are not scraped; import your existing exports. Figma records require selected exports or authorized frame access. A previous virus scan does not establish a content license or prove arbitrary code safe.

To enable a licensed code asset after reading its exact source, imports, and license:

```bash
npm run corpus:review -- reference-id=EXACT_CODE_SHA256 \
  --note 'Evidence from the static review and required adaptation steps'
```

The hash binds the review to the inspected version. The ledger records the review; future recollection resets it. Static review is not a guarantee of runtime security. Preserve upstream copyright/license notices when adapting code.
