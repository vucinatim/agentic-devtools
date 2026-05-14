import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "vitest";

const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));

test("Codex adapter configs run published package through npx", async () => {
  const cases = [
    {
      path: "adapters/codex/namecheap/.mcp.json",
      server: "namecheap",
      tool: "namecheap",
    },
    {
      path: "adapters/codex/railway/.mcp.json",
      server: "railway",
      tool: "railway",
    },
  ];

  for (const entry of cases) {
    const config = await readJson(entry.path);
    const server = config.mcpServers[entry.server];

    assert.equal(server.command, "npx");
    assert.deepEqual(server.args, [
      "-y",
      "@vucinatim/agentic-devtools",
      "mcp",
      entry.tool,
    ]);
  }
});

test("Codex adapter manifests point at current public repo paths", async () => {
  const cases = [
    "adapters/codex/namecheap/.codex-plugin/plugin.json",
    "adapters/codex/railway/.codex-plugin/plugin.json",
  ];

  for (const path of cases) {
    const manifest = await readJson(path);

    assert.equal(manifest.license, "MIT");
    assert.match(manifest.repository, /agentic-devtools\/tree\/main\/adapters\/codex\//);
    assert.doesNotMatch(manifest.repository, /plugins\//);
  }
});
