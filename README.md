# AI UI Cleaner

AI UI Cleaner bundles a design skill with a public reference-search MCP for Codex (desktop and terminal) and Claude Code (Code tab and terminal). Install the plugin once to get both. No separate skill download, corpus download, Cloudflare account, Node runtime or MCP API key is needed. Your chosen host still needs its normal account/login and internet access.

## How it designs

1. Resolve the target: mobile app, mobile web, desktop app/web, tablet or responsive website. Ask when unclear.
2. Resolve the vibe from the brief or supplied design; ask when missing, rather than infer it from the product category.
3. Search the RAG library for that **surface and visual structure**, not simply the product prompt.
4. Inspect 3–5 matching screenshots and choose one primary frame.
5. Reconstruct its visible composition, compare the rendered layout, then replace the content with the user's information.
6. For responsive sites, inspect a suitable other-viewport reference and adapt the layout—not just shrink desktop.

The screenshot is in the MCP response's `content[]` image block; `structuredContent` is metadata only. The agent must display and inspect those pixels, reject mismatched candidates, and compare the reconstruction with one chosen frame. If images cannot be viewed, it stops and requests a working reference rather than building from captions. A generated hero image is not a substitute for the layout reference. Every visible control must be exercised, genuinely disabled with an explanation, or omitted—not left looking functional.

Existing product requirements and explicit user instructions stay authoritative. Unrequested all-caps labels, decorative numbering, metric strips and crude geometric models remain disabled. Screenshots are evidence, not permission to reuse unlicensed branding, assets or code. Review-only requests do not change files.

## Install

The repository is [MustafaHam123/ai-ui-cleaner](https://github.com/MustafaHam123/ai-ui-cleaner). These GitHub instructions install the version **pushed to GitHub**, not uncommitted local changes. The owner must push updated manifests and skills before sharing a new version.

### Codex desktop app

For a local GUI setup, download/clone this repository, open it as a Codex project, restart the app, and open Plugins. Select `ai-ui-cleaner-marketplace`, then install AI UI Cleaner. Codex supports the repository's `.claude-plugin/marketplace.json` catalog. If it is not discovered, use explicit source registration below. [Official marketplace guidance](https://developers.openai.com/plugins/build/plugins).

For GitHub installs, register the source once:

```bash
codex plugin marketplace add MustafaHam123/ai-ui-cleaner
```

Then open the app's Plugins page, select that marketplace and install AI UI Cleaner. Start a new chat in your target project and invoke `$ai-ui-cleaner`. An [install link](codex://plugins/install/ai-ui-cleaner?marketplace=ai-ui-cleaner-marketplace) works only after the marketplace is known; it does not register GitHub automatically.

### Codex terminal

Run these in your shell with a current Codex CLI:

```bash
codex plugin marketplace add MustafaHam123/ai-ui-cleaner
codex plugin add ai-ui-cleaner@ai-ui-cleaner-marketplace
codex plugin list --marketplace ai-ui-cleaner-marketplace --json
```

Start a new Codex session in your target project. Invoke `$ai-ui-cleaner` followed by your task. Local desktop and CLI plugin settings share the same Codex home on the same machine; a different machine/remote host needs its own installation. [Official plugin commands](https://learn.chatgpt.com/docs/developer-commands#codex-plugin).

### Claude Code desktop app

1. Open **Settings → Plugins → Add → Add Marketplace → Add from a repository**.
2. Enter `https://github.com/MustafaHam123/ai-ui-cleaner` (without `.git`) and select Sync.
3. Select AI UI Cleaner and Install; choose the appropriate scope.
4. Start a new local **Code** session in your target project. Invoke `/ai-ui-cleaner:ai-ui-cleaner` or select the skill from the slash-command picker.

The Code tab also offers **+ → Plugins → Add plugin**. Menus depend on app version and organization policy. This is not a promise that the same installation works in Chat, Cowork, WSL or cloud sessions. [GUI repository installation example](https://developers.openai.com/learn/developers-codex-plugin), [Claude Code desktop plugins](https://code.claude.com/docs/en/desktop#install-plugins).

### Claude Code terminal

Inside an interactive Claude Code session:

```text
/plugin marketplace add MustafaHam123/ai-ui-cleaner
/plugin install ai-ui-cleaner@ai-ui-cleaner-marketplace
```

Restart the session, then invoke `/ai-ui-cleaner:ai-ui-cleaner` followed by your task. Use `/plugin` to inspect enabled state and installation scope. These are Claude slash commands, not shell commands. [Official installation example](https://developers.openai.com/learn/developers-codex-plugin).

### Use it

Codex prompt:

```text
$ai-ui-cleaner Build a responsive Porsche website, desktop-first, bright and restrained with large photography. Find 3–5 matching desktop frames, reconstruct one, then adapt my content and mobile layout.
```

Claude prompt:

```text
/ai-ui-cleaner:ai-ui-cleaner Build a mobile app onboarding flow, colorful and playful. Inspect 3–5 mobile app references, reconstruct one primary screen, then adapt my content.
```

To check the clarification gate, send `Build a cool Porsche website` with the skill invoked and no existing design brief: it should ask about the target and vibe **before searching**. For a reference-only check, specify the target/vibe and add `Do not implement yet; show the selected references and primary frame plan.` Expect `search_references`, `get_reference` and `get_reference_asset` calls and actual image inspection. This verifies behavior, not just connection status.

### Update or troubleshoot

- **Old prompt behavior:** update the marketplace and installed plugin, then start a new session. Changing source files does not change an already cached installation. Codex: `codex plugin marketplace upgrade ai-ui-cleaner-marketplace`, then refresh/reinstall through Plugins. Claude: refresh the marketplace and update the plugin through `/plugin` or the app.
- **Marketplace missing:** check spelling, repository access and whether the catalog was pushed. For a local checkout, Codex can register it with `codex plugin marketplace add /absolute/path/to/ai-ui-cleaner`; inside Claude use `/plugin marketplace add /absolute/path/to/ai-ui-cleaner`.
- **Tools but no skill:** an MCP URL alone does not install `SKILL.md`. Install the plugin, not just the server.
- **Skill but no images/tools:** check that the plugin is enabled and the host can reach `https://ai-ui-cleaner.ai-ui-cleaner.workers.dev/mcp`. Do not add a duplicate MCP if the plugin already supplies it. Opening `/mcp` as an ordinary webpage is not a protocol test.
- **“Only metadata returned”:** inspect the complete `get_reference_asset` response. Forward/display its `content[]` image block using the host's image viewer; do not inspect only `structuredContent`. If rendering still fails, stop the reference-led build and report the problem.
- **Unsupported plugin commands:** update the host. If necessary, install the skill folder manually in the project's `.agents/skills/` (Codex) or `.claude/skills/` (Claude), and separately register the hosted HTTP MCP using the host's MCP instructions.

The package paths and tests are checked in this repo. A complete GUI install is a separate check; Claude Code is not installed in the development environment. Do not treat a passing unit test as proof of installation in either desktop app.

## Where everything lives

GitHub contains the skill, manifests, MCP source, schemas, migrations and small original seed records. The hosted corpus metadata/search lives in Cloudflare D1/Vectorize, and screenshots live in the dedicated `ai-ui-cleaner-corpus` R2 bucket. Installing does not upload data or create cloud resources. No npm publication or separate skill website is required for this custom marketplace.

The corpus setup/owner workflow is separate: see [Cloudflare deployment and quotas](docs/cloudflare.md). Owner setup never uses `quran-mode-assets` or changes existing websites/domains. Hosted queries may consume the owner's service quotas; “no installer API key” does not mean unlimited or cost-free hosting.

## Local development (not required for installation)

```bash
npm install
npm run build
npm run check
```

`npm start` runs the local stdio MCP; `npm run start:http` serves `http://localhost:3000/mcp` with health at `/health`. These local modes use local/seed data unless cloud forwarding is configured. Plugin configurations instead connect directly to the hosted public corpus.

`npm run mcp:check` verifies anonymous hosted discovery, search, metadata and one image fetch. Search may use a query embedding; this does not caption images or mutate the corpus. It does not install a plugin.

Package layout: `plugin.json`, `mcp.json`, `skills/`, `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `.mcp.json`. The bundled `dist/index.cjs` is for local stdio development; rebuild after server changes. Never commit credentials.

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
