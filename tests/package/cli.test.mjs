import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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

test("CLI reports Railway auth status without credentials", () => {
  const result = runCli(["auth-status", "railway"], {
    RAILWAY_PROJECT_TOKEN: "",
    RAILWAY_API_TOKEN: "",
    RAILWAY_TOKEN: "",
  });

  assert.equal(result.status, 0);
  const status = JSON.parse(result.stdout);
  assert.equal(status.configured, false);
  assert.equal(status.kind, null);
});

test("CLI rejects unknown tools", () => {
  const result = runCli(["auth-status", "unknown"]);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /auth-status expects one of/);
});
