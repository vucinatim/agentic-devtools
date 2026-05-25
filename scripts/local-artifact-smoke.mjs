#!/usr/bin/env node
// Gate 1 — Local artifact smoke.
//
// Builds the actual npm tarball with `npm pack`, installs it into a throwaway
// temp project, and runs end-to-end assertions against the resulting install:
//
//   - The CLI binary loads, prints --help, registers all expected MCPs
//   - `tools` subcommand returns the full provider list
//   - `auth-status npm` returns valid JSON shape
//   - `mcp <provider> --help` works for every provider
//   - Root index re-exports every per-provider client + helper
//
// This catches packaging-time bugs (wrong files list, missing root exports,
// stale subcommand banner) BEFORE we publish to npm. Unit tests pass against
// in-tree modules and never exercise the packaged artifact.
//
// Wired into `npm run check` so it runs on every CI build.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const PACKAGE_NAME = "@vucinatim/agentic-devtools";
const PROVIDERS = ["cloudflare", "namecheap", "railway", "npm", "axiom"];

const execCommand = async (command, args, { cwd } = {}) => {
  const result = await new Promise((resolveExec, rejectExec) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", rejectExec);
    child.on("close", (status) => {
      resolveExec({ status: status ?? 1, stdout, stderr });
    });
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return result;
};

const execJsonCommand = async (command, args, options) =>
  JSON.parse((await execCommand(command, args, options)).stdout);

const packTarball = async () => {
  // npm pack writes the tarball into cwd and prints its filename on stdout.
  const result = await execCommand("npm", ["pack", "--silent"], {
    cwd: REPO_ROOT,
  });
  const filename = result.stdout.trim().split(/\s+/).filter(Boolean).pop();
  if (!filename) {
    throw new Error("npm pack did not return a tarball filename.");
  }
  const tarballPath = resolve(REPO_ROOT, filename);
  if (!existsSync(tarballPath)) {
    throw new Error(`Expected tarball at ${tarballPath} but it does not exist.`);
  }
  return tarballPath;
};

const installTarballInto = async (cwd, tarballPath) => {
  await mkdir(cwd, { recursive: true });
  await writeFile(
    join(cwd, "package.json"),
    JSON.stringify(
      { name: "local-smoke-cli", private: true, type: "module" },
      null,
      2,
    ),
  );
  await execCommand("npm", ["install", tarballPath], { cwd });
  return join(cwd, "node_modules", ".bin", "agentic-devtools");
};

const testCliSurface = async ({ tempRoot, tarballPath }) => {
  console.log("  → CLI surface (project-local bin invocation)...");
  const cwd = join(tempRoot, "cli");
  const binary = await installTarballInto(cwd, tarballPath);

  const help = await execCommand(binary, ["--help"], { cwd });
  assert.match(
    help.stdout,
    /agentic-devtools mcp <cloudflare\|namecheap\|railway\|npm\|axiom>/,
    "CLI --help banner missing expected mcp providers",
  );

  const tools = await execJsonCommand(binary, ["tools"], { cwd });
  assert.deepEqual(
    tools.map((tool) => tool.name),
    PROVIDERS,
    "`tools` subcommand did not return every provider in the expected order",
  );

  const npmAuthStatus = await execJsonCommand(
    binary,
    ["auth-status", "npm"],
    { cwd },
  );
  assert.equal(typeof npmAuthStatus.configured, "boolean");
  assert.equal(typeof npmAuthStatus.registry, "string");

  for (const provider of PROVIDERS) {
    const result = await execCommand(binary, ["mcp", provider, "--help"], {
      cwd,
    });
    assert.match(
      result.stdout,
      new RegExp(`Usage: agentic-devtools mcp ${provider}`),
      `mcp ${provider} --help banner missing`,
    );
  }
};

const testGlobalInstall = async ({ tempRoot, tarballPath }) => {
  console.log("  → Global install + binary invocation...");
  const prefix = join(tempRoot, "global");
  await execCommand("npm", ["install", "-g", "--prefix", prefix, tarballPath]);

  const candidates =
    process.platform === "win32"
      ? [
          join(prefix, "agentic-devtools.cmd"),
          join(prefix, "bin", "agentic-devtools.cmd"),
        ]
      : [join(prefix, "bin", "agentic-devtools")];
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) {
    throw new Error(
      `Could not find installed agentic-devtools binary under prefix ${prefix}.`,
    );
  }

  const help = await execCommand(binary, ["--help"]);
  assert.match(
    help.stdout,
    /agentic-devtools connect <cloudflare\|namecheap\|railway\|npm\|axiom>/,
    "connect banner missing expected providers",
  );

  const tools = await execJsonCommand(binary, ["tools"]);
  assert.deepEqual(
    tools.map((tool) => tool.name),
    PROVIDERS,
  );
};

const testRootExports = async ({ tempRoot, tarballPath }) => {
  console.log("  → Root exports + per-provider subpaths...");
  const projectDir = join(tempRoot, "project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    join(projectDir, "package.json"),
    JSON.stringify(
      { name: "local-artifact-smoke", private: true, type: "module" },
      null,
      2,
    ),
  );
  await execCommand("npm", ["install", tarballPath], { cwd: projectDir });

  const importCheck = await execJsonCommand(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
        import {
          listTools,
          createCloudflareClient,
          createNamecheapClient,
          createRailwayClient,
          createNpmClient,
          createAxiomClient
        } from "${PACKAGE_NAME}";
        import { encodePackageName } from "${PACKAGE_NAME}/npm";

        process.stdout.write(JSON.stringify({
          toolNames: listTools().map((tool) => tool.name),
          exports: {
            createCloudflareClient: typeof createCloudflareClient,
            createNamecheapClient: typeof createNamecheapClient,
            createRailwayClient: typeof createRailwayClient,
            createNpmClient: typeof createNpmClient,
            createAxiomClient: typeof createAxiomClient,
            encodePackageName: encodePackageName("@scope/pkg")
          }
        }));
      `,
    ],
    { cwd: projectDir },
  );

  assert.deepEqual(importCheck.toolNames, PROVIDERS);
  assert.deepEqual(importCheck.exports, {
    createCloudflareClient: "function",
    createNamecheapClient: "function",
    createRailwayClient: "function",
    createNpmClient: "function",
    createAxiomClient: "function",
    encodePackageName: "%40scope%2Fpkg",
  });
};

const run = async () => {
  console.log("Gate 1 — Local artifact smoke");
  console.log("  → Packing tarball with `npm pack`...");
  const tarballPath = await packTarball();

  const tempRoot = await mkdtemp(
    join(os.tmpdir(), "agentic-devtools-local-smoke-"),
  );

  try {
    await testCliSurface({ tempRoot, tarballPath });
    await testGlobalInstall({ tempRoot, tarballPath });
    await testRootExports({ tempRoot, tarballPath });
    console.log("Gate 1 PASSED — local artifact behaves as expected.");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
    await rm(tarballPath, { force: true });
  }
};

await run();
