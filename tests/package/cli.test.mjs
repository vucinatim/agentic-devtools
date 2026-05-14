import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

const runCli = (args, env = {}) =>
  spawnSync(process.execPath, ["src/cli.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });

test("CLI prints usage", () => {
  const result = runCli(["--help"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /agentic-devtools mcp <namecheap\|railway>/);
  assert.match(result.stdout, /agentic-devtools connect <namecheap\|railway>/);
});

test("README-facing npx command shape maps to the CLI contract", () => {
  const args = ["-y", "@vucinatim/agentic-devtools", "mcp", "railway"];

  assert.deepEqual(args.slice(2), ["mcp", "railway"]);
});

test("CLI lists registered tools as JSON", () => {
  const result = runCli(["tools"]);

  assert.equal(result.status, 0);
  const tools = JSON.parse(result.stdout);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ["namecheap", "railway"],
  );
});

test("CLI reports Railway auth status without credentials", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "railway-cli-"));
  const result = runCli(["auth-status", "railway"], {
    RAILWAY_PROJECT_TOKEN: "",
    RAILWAY_API_TOKEN: "",
    RAILWAY_TOKEN: "",
    RAILWAY_AUTH_CONFIG_PATH: path.join(tempDir, "missing.json"),
  });

  assert.equal(result.status, 0);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, false);
  assert.equal(status.kind, null);
});

test("CLI reports stored Railway auth status without leaking the token", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "railway-cli-"));
  const authPath = path.join(tempDir, "railway.json");
  await writeFile(
    authPath,
    JSON.stringify({
      token: "stored-token",
      kind: "project",
      defaultProjectId: "project-id",
      savedAt: new Date().toISOString(),
    }),
  );

  const result = runCli(["auth-status", "railway"], {
    RAILWAY_PROJECT_TOKEN: "",
    RAILWAY_API_TOKEN: "",
    RAILWAY_TOKEN: "",
    RAILWAY_AUTH_CONFIG_PATH: authPath,
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /stored-token/);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, true);
  assert.equal(status.source, "file");
  assert.equal(status.defaultProjectId, "project-id");
});

test("CLI rejects unknown tools", () => {
  const result = runCli(["auth-status", "unknown"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth-status expects one of/);
});
