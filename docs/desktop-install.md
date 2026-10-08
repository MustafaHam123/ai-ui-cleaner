# Desktop installation

Install the plugin, not just the MCP connection: the plugin contains `skills/ai-ui-cleaner/SKILL.md` and the public MCP configuration. No installer API key, Cloudflare account, Node installation, or database download is needed. An app subscription/account and internet access are still required. This covers Codex desktop and Claude's **Code tab**, not a guarantee for every Chat/Cowork/cloud environment.

## Where the skill lives

The source is [MustafaHam123/ai-ui-cleaner](https://github.com/MustafaHam123/ai-ui-cleaner), under `skills/ai-ui-cleaner/`. The catalog at `.claude-plugin/marketplace.json` points to the repository root, so installing `ai-ui-cleaner` downloads the skill and MCP configuration together. References are fetched on demand from the hosted MCP; the corpus is not bundled in GitHub.

The owner must commit and push the desktop catalog and packaging changes before other people can install this version from GitHub. Keep the repository public for anonymous downloads. No npm publication, separate skill website, or official store submission is required for this custom marketplace. Store listing is a separate, optional review process.

## Codex desktop: local, no terminal

1. Open this repository as a project in Codex.
2. Restart the app after adding the marketplace catalog.
3. Open Plugins and choose `ai-ui-cleaner-marketplace` as the source, then install AI UI Cleaner.
4. Start a new chat and invoke `$ai-ui-cleaner` with your task.

Codex supports the legacy-compatible `.claude-plugin/marketplace.json` catalog. A local plugin detail link can also open the install page: `codex://plugins/ai-ui-cleaner?marketplacePath=<URL-encoded absolute path to .claude-plugin/marketplace.json>`. That path is machine-specific; do not share your own path as a universal installer.

For GitHub distribution, the documented one-time source registration is:

```bash
codex plugin marketplace add MustafaHam123/ai-ui-cleaner
```

After registering, install through the app's Plugins page. A detail link for an already registered marketplace is [Install AI UI Cleaner](codex://plugins/install/ai-ui-cleaner?marketplace=ai-ui-cleaner-marketplace). This link does not register an unknown GitHub marketplace. A fully GUI alternative is downloading/cloning the repository, opening it as a project, and following the local steps above. Do not assume an arbitrary GitHub URL can be installed directly from a single link.

## Claude Code desktop

1. In Claude, open **Settings → Plugins → Add → Add Marketplace → Add from a repository**.
2. Enter `https://github.com/MustafaHam123/ai-ui-cleaner` and select Sync.
3. Select AI UI Cleaner and Install.
4. In a new local Code session, invoke `/ai-ui-cleaner:ai-ui-cleaner` with your task. The slash-command picker can show the installed skill too.

The Code tab also exposes the plugin browser through **+ → Plugins → Add plugin**, and Manage plugins controls enabled state and scope. Menu labels can vary with app versions and organization policy. If the catalog changes, refresh/sync the marketplace; update or reinstall the plugin to load the changed installed copy. Do not separately register the same MCP if the plugin already provides it.

## Verify from a new chat

Ask: “Use AI UI Cleaner to search for doctor appointment references, inspect two screenshots, and explain what can be adapted. Do not implement yet.”

Confirm the agent uses `search_references`, `get_reference`, and `get_reference_asset`, and actually views the selected images. A successful MCP connection alone does not establish that the skill loaded. The skill makes corpus retrieval the primary reference path, with web discovery reserved for a concrete gap.

Developer check: `npm run mcp:check` verifies anonymous discovery, search, metadata, and one image fetch. It does not install either desktop app's plugin. Desktop installation must be verified separately; there is no Claude CLI installed in this development environment.

## Official guidance

- [OpenAI plugin packaging and desktop marketplaces](https://developers.openai.com/plugins/build/plugins)
- [Codex plugin links](https://learn.chatgpt.com/docs/reference/commands#plugins)
- [Claude desktop plugins](https://code.claude.com/docs/en/desktop#install-plugins)
- [Repository marketplace GUI setup example](https://developers.openai.com/learn/developers-codex-plugin)
- [Claude marketplace creation](https://code.claude.com/docs/en/plugin-marketplaces)
