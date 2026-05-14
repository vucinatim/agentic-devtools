import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  isTruthyEnv,
  readJsonConfig,
  removeJsonConfig,
  resolveConfigPath,
  writeJsonConfig,
} from "../../src/core/config-store.mjs";

test("writes, reads, and removes JSON config files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-config-"));
  const configPath = path.join(tempDir, "tool.json");

  await writeJsonConfig(configPath, { token: "secret" });

  assert.deepEqual(await readJsonConfig(configPath), { token: "secret" });
  assert.match(await readFile(configPath, "utf8"), /\n$/);

  await removeJsonConfig(configPath);
  assert.equal(await readJsonConfig(configPath), null);
});

test("resolves config path overrides and truthy env values", () => {
  assert.equal(
    resolveConfigPath({
      env: { TOOL_CONFIG_PATH: "/tmp/tool.json" },
      envVar: "TOOL_CONFIG_PATH",
      fileName: "tool.json",
    }),
    "/tmp/tool.json",
  );
  assert.equal(isTruthyEnv("YES"), true);
  assert.equal(isTruthyEnv("0"), false);
});
