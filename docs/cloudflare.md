# Hosted reference corpus

The skill does not connect to a database by itself. It tells the model to call MCP tools. The MCP Worker searches the corpus, then returns only selected descriptions, guidance, images, or reviewed code. No special GPT/Claude model is trained here; RAG retrieves evidence for the model already running in the host.

| Service | Stores |
|---|---|
| D1 | Reference records, implementation guidance, license/review state, chunks, FTS5 keyword index |
| R2 | Preview images, source snapshots, license notices |
| Vectorize | Semantic text embeddings; Workers AI generates 768-dimensional BGE embeddings |

Git contains source, schemas, migrations, the skill, and the small source manifest—not the harvested corpus or embeddings. `data/local/`, `.wrangler/`, secrets, and generated account configuration are ignored.

Resources are isolated: the asset bucket is `ai-ui-cleaner-corpus`, never `quran-mode-assets`; the D1 database, Vectorize index, and Worker are named `ai-ui-cleaner`. Deployment uses only workers.dev and has no custom-domain routes or DNS changes. Local collection files remain as an ignored backup/staging area; deployed MCP reads D1/R2/Vectorize rather than those local files.

## Current collection

The initial bounded collection has 28 references from six sources: 21st.dev (10), shadcn/ui (6), Radix UI (5), Headless UI (1), daisyUI (1), and recent.design (5). It includes five item-specific gallery posters and three MIT-licensed shadcn code assets. These are starting coverage, not a complete scrape of any catalog.

Descriptions and implementation notes are curator-authored, general principles with pattern-specific steps. A gallery poster is labeled as a poster, not a captured full-page screenshot; motion-first posters cannot establish a full page's hierarchy. Reference material should inform a new design, not supply copied branding, copy, assets, or a complete composition.

The local Cloudflare emulator uses persistent D1/FTS5 and R2. It does **not** run hosted semantic embeddings. Vectorize and Workers AI activate only after account resources are provisioned and the Worker is deployed; keyword search remains available if semantic retrieval fails. Submitted vector mutations may take time to become searchable.

Keyword candidates must also match task-specific titles, summaries, tags, components, or implementation steps. A word occurring only in generic instructions or a CSS pseudo-element does not establish relevance. Broad industry/style filters may exclude neutral functional examples; search without unnecessary filters when coverage is thin. Text embeddings do not inspect pixels—the model must actually request and view selected image assets.

## Image-specific retrieval metadata

The visual-library pipeline downloads exact public image URLs observed through the normal browser, deduplicates by source path and SHA-256, and verifies image signatures. Captions can come from Cloudflare Workers AI or direct visual inspection by the chat assistant; the stored model attribution identifies the actual method. It does not bypass login gates or scrape account credentials. Downloads, captions, semantic indexing and human review are separate stages; a downloaded image is not automatically an indexed or curator-reviewed reference.

Each image gets a JSON sidecar with source URL, author when available, byte digest, caption model/version, capture date, visible description, presentation type, layout, palette, typography, imagery, task/component tags, search phrases, use/mismatch cases, transferable principles, proposed implementation steps, adaptation suggestions, uncertainty and evidence gaps. A montage's presentation is distinguished from the layout of the website within it. Guessed fonts, frameworks, interaction behavior and accessibility compliance are not recorded as verified facts.

`visualMetadata` is stored in D1 for UI references. Image-specific descriptions, layout, aliases and relevant task guidance feed text embeddings and keyword search; repeated workflow/safety boilerplate is excluded from image embeddings. Search returns compact cards; `get_reference` returns full metadata, and `get_reference_asset` returns the actual selected image. High caption confidence is not human review. The skill must inspect pixels before making visual claims and adapt relationships to the user's content instead of copying a source.

Images live in R2 under `assets/dribbble/`; full JSON sidecars live under `raw/dribbble/`. Non-interface images receive accurate sidecars but are excluded from UI retrieval. The bucket itself stays private. Public MCP access retrieves selected UI references, not the owner's administration credential.

Owner commands after authorized source acquisition:

```bash
npm run corpus:images -- /absolute/path/to/browser-bundle/manifest.json
node --import tsx scripts/download-source-images.ts
npm run corpus:caption -- --publish --concurrency=6
npm run corpus:stage-images
```

The downloader consumes validated source exports in `data/local/dribbble/source-exports/`; it does not generate source URLs or scrape protected pages. The local-only `scripts/source-export-server.ts` helper can save public links gathered through browser DOM inspection. Captioning uses the owner's saved Wrangler OAuth session, not an installer API key. Its limit is 1,000 images per run, concurrency is bounded to 8, and inference stops at 250,000 reported neurons per run or an authorization/quota failure. Inference and storage quotas/billing apply; no plan upgrade is attempted. Captions and publication receipts are checkpointed per image so reruns reuse progress. Validation failures have no generic fabricated fallback. `metadata-report.json` reports completed captions, interface references and failures; `images.json` tracks downloads independently. These artifacts are ignored by Git.

`corpus:stage-images -- --resume-stored` stores provenance/status sidecars and keyword records without calling AI. Unchanged, checkpointed images are not uploaded again. Source alt text or URL titles remain explicitly labeled as source text, not visual analysis. Source-only records contain no invented layout or pattern-specific implementation. Complete captions retain their task-specific metadata and actual captioner attribution. Known non-interface images are reversibly excluded from search and public reference lookup using an owner-only endpoint; original objects and records remain retained. Owner-only ingestion supports `indexSemantic: false`; anonymous MCP clients cannot set it. `stage-report.json` distinguishes stored images, visual captions, keyword-only records, excluded artwork and pending work. Captions do not imply semantic embeddings have been generated. The scripts never upgrade billing.

For direct inspection without an inference API, `scripts/describe-local-images.ts sheet <offset>` produces numbered local contact sheets. The assistant must actually inspect each image before authoring compact observations; `save <observations.json>` expands and validates those observations against the same caption schema. Source and pixel evidence remain separate. This helper does not automatically generate descriptions, call Cloudflare AI or assert human review. Local observations, sheets and metadata stay outside Git.

## Provision and deploy in your Cloudflare account

Only the library owner needs a Cloudflare account. Run `npx wrangler login` and approve the browser prompt once; setup securely retrieves that saved OAuth credential without printing it. No API token needs to be copied. CI can optionally use `CLOUDFLARE_API_TOKEN`. Set `CLOUDFLARE_ACCOUNT_ID` when more than one account is accessible. R2/Workers AI may require enabling those services in your account; quotas and billing apply.

```bash
npm run cloud:setup
```

This reuses matching named resources, creates missing resources, checks embedding dimensions, adds required metadata indexes, applies migrations, deploys a public read-only MCP, installs private admin secrets, uploads the existing curated corpus and assets, and verifies retrieval. No dashboard uploads are required. It never deletes or recreates incompatible indexes. A partial failure can leave resources created; rerun after fixing the reported error. Keep applied migrations immutable.

The script saves configuration in ignored `wrangler.generated.json`, credentials in ignored `data/local/cloud-secrets.json`, and the verified URL in ignored `data/local/cloud-deployment.json`. Existing secrets are reused. After successful synchronization, `data/local/mcp-public.json` contains an installer configuration with only the URL and no secrets. Do not distribute the admin credential.

For a later standalone upload, set the Worker origin as `AI_UI_CLEANER_CLOUD_URL` and the local owner credential as `ADMIN_TOKEN`:

```bash
npm run cloud:sync -- data/local/references.jsonl --preserve-review-status
```

Only use `--preserve-review-status` for an explicitly reviewed corpus. Otherwise imported code is reset to unreviewed. Uploads are bounded, redirects are rejected, and retries are limited to transient errors. `data/local/sync-report.json` records failures; upload is idempotent per reference ID. An embedding failure may leave keyword data saved; retry the failed record to complete semantic indexing.

## Point the installed MCP at the cloud

People using a host with Streamable HTTP support add the printed `/mcp` URL. Public deployments require no Cloudflare account, login, or key. The generated `mcp-public.json` uses an HTTP MCP entry; exact setup labels differ between hosts.

For hosts needing the local stdio bridge, set only this variable:

```text
AI_UI_CLEANER_CLOUD_URL=https://your-deployed-worker-origin
```

Run the usual bundled plugin server. It forwards the same five MCP tools to the remote corpus instead of loading local JSONL. There is no silent fallback when the remote service fails. Do not pass the admin token to the model-facing process.

Public access is explicit (`PUBLIC_MCP=true`); otherwise the endpoint still requires `MCP_READ_TOKEN`. All administration remains authenticated. Public requests are capped at 120 per minute per IP per Cloudflare location, with a 64 KB request-body limit. Shared-network users share this allowance. These are abuse mitigations, not a global quota or billing cap: configure account usage monitoring before broad distribution. Source code still requires license and review gates; anonymous access does not grant redistribution rights to third-party designs.

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
