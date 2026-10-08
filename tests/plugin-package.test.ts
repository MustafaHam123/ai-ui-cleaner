import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const json = async (path: string) => JSON.parse(await readFile(new URL(path, root), "utf8"));

test("desktop marketplace resolves the bundled skill and both host manifests", async () => {
  const catalog = await json(".claude-plugin/marketplace.json");
  assert.equal(catalog.name, "ai-ui-cleaner-marketplace");
  assert.ok(catalog.owner.name);
  assert.equal(catalog.plugins.length, 1);
  const entry = catalog.plugins[0];
  assert.equal(entry.source, "./");
  assert.equal(entry.policy.installation, "AVAILABLE");
  for (const path of ["plugin.json", ".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
    const manifest = await json(path);
    assert.equal(manifest.name, entry.name);
    assert.equal(manifest.version, entry.version);
  }
  const codex = await json(".codex-plugin/plugin.json");
  await access(new URL(codex.mcpServers, root));
  const skill = await readFile(new URL(`${codex.skills}ai-ui-cleaner/SKILL.md`, root), "utf8");
  assert.match(skill, /^---\nname: ai-ui-cleaner\n/);
  for (const tool of ["search_references", "get_reference", "get_reference_asset"]) {
    assert.ok(skill.includes(tool), `Skill must explain ${tool}`);
  }
});

test("desktop packages use the same anonymous hosted MCP without a local runtime", async () => {
  const portable = await json("mcp.json");
  const compatible = await json(".mcp.json");
  assert.deepEqual(portable.mcpServers, compatible.mcpServers);
  assert.deepEqual(compatible.mcpServers.ai_ui_cleaner, {
    type: "http",
    url: "https://ai-ui-cleaner.ai-ui-cleaner.workers.dev/mcp",
  });
});
