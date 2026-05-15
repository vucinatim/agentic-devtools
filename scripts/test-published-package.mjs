#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_PACKAGE_NAME = "@vucinatim/agentic-devtools";
const DEFAULT_WAIT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_WAIT_INTERVAL_MS = 5 * 1000;

const parseArgs = (argv) => {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
      continue;
    }

    parsed[key] = "true";
  }

  return parsed;
};

const args = parseArgs(process.argv.slice(2));
const packageName = String(args.package ?? DEFAULT_PACKAGE_NAME);
const requestedVersion = args.version ? String(args.version) : null;
const waitTimeoutMs = Number(args["wait-timeout-ms"] ?? DEFAULT_WAIT_TIMEOUT_MS);
const waitIntervalMs = Number(
  args["wait-interval-ms"] ?? DEFAULT_WAIT_INTERVAL_MS,
);

const run = async () => {
  const version = requestedVersion ?? (await getPublishedLatestVersion(packageName));
  const packageSpec = `${packageName}@${version}`;

  console.log(`Testing published package ${packageSpec}`);
  await waitForPublishedVersion({
    packageName,
    version,
    waitTimeoutMs,
    waitIntervalMs,
  });

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentic-devtools-published-"));

  try {
    await testNpxUsage({
      packageSpec,
      tempRoot,
      waitTimeoutMs,
      waitIntervalMs,
    });
    await testGlobalInstallUsage({
      packageSpec,
      tempRoot,
      waitTimeoutMs,
      waitIntervalMs,
    });
    await testProjectDependencyUsage({
      packageSpec,
      tempRoot,
      waitTimeoutMs,
      waitIntervalMs,
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }

  console.log(`Published package ${packageSpec} passed smoke tests.`);
};

const testNpxUsage = async ({
  packageSpec,
  tempRoot,
  waitTimeoutMs: timeoutMs,
  waitIntervalMs: intervalMs,
}) => {
  console.log("Checking npx usage...");
  const cwd = path.join(tempRoot, "npx");
  await mkdir(cwd, { recursive: true });

  await withPackageAvailabilityRetry(
    async () => {
      const help = await execCommand("npx", ["-y", packageSpec, "--help"], {
        cwd,
      });
      assert.match(
        help.stdout,
        /agentic-devtools mcp <cloudflare\|namecheap\|railway\|npm>/,
      );

      const tools = await execJsonCommand(
        "npx",
        ["-y", packageSpec, "tools"],
        { cwd },
      );
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["cloudflare", "namecheap", "railway", "npm"],
      );

      const npmAuthStatus = await execJsonCommand(
        "npx",
        ["-y", packageSpec, "auth-status", "npm"],
        { cwd },
      );
      assert.equal(typeof npmAuthStatus.configured, "boolean");
      assert.equal(typeof npmAuthStatus.registry, "string");

      for (const toolName of ["cloudflare", "namecheap", "railway", "npm"]) {
        const helpResult = await execCommand(
          "npx",
          ["-y", packageSpec, "mcp", toolName, "--help"],
          { cwd },
        );
        assert.match(
          helpResult.stdout,
          new RegExp(`Usage: agentic-devtools mcp ${toolName}`),
        );
      }
    },
    { packageSpec, timeoutMs, intervalMs },
  );
};

const testGlobalInstallUsage = async ({
  packageSpec,
  tempRoot,
  waitTimeoutMs: timeoutMs,
  waitIntervalMs: intervalMs,
}) => {
  console.log("Checking global install usage...");

  const prefix = path.join(tempRoot, "global");
  await withPackageAvailabilityRetry(
    async () => {
      await execCommand("npm", ["install", "-g", "--prefix", prefix, packageSpec]);

      const binaryCandidates =
        process.platform === "win32"
          ? [
              path.join(prefix, "agentic-devtools.cmd"),
              path.join(prefix, "bin", "agentic-devtools.cmd"),
            ]
          : [path.join(prefix, "bin", "agentic-devtools")];
      const binaryPath = binaryCandidates.find((candidate) => existsSync(candidate));

      if (!binaryPath) {
        throw new Error(
          `Could not find installed agentic-devtools binary under prefix ${prefix}.`,
        );
      }

      const help = await execCommand(binaryPath, ["--help"]);
      assert.match(
        help.stdout,
        /agentic-devtools connect <cloudflare\|namecheap\|railway\|npm>/,
      );

      const tools = await execJsonCommand(binaryPath, ["tools"]);
      assert.deepEqual(
        tools.map((tool) => tool.name),
        ["cloudflare", "namecheap", "railway", "npm"],
      );
    },
    { packageSpec, timeoutMs, intervalMs },
  );
};

const testProjectDependencyUsage = async ({
  packageSpec,
  tempRoot,
  waitTimeoutMs: timeoutMs,
  waitIntervalMs: intervalMs,
}) => {
  console.log("Checking project dependency usage...");

  const projectDir = path.join(tempRoot, "project");
  await mkdir(projectDir, { recursive: true });
  await writeFile(
    path.join(projectDir, "package.json"),
    JSON.stringify(
      {
        name: "published-package-smoke",
        private: true,
        type: "module",
      },
      null,
      2,
    ),
  );

  await withPackageAvailabilityRetry(
    async () => {
      await execCommand("npm", ["install", packageSpec], {
        cwd: projectDir,
      });

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
          createNpmClient
        } from "${packageName}";
        import { encodePackageName } from "${packageName}/npm";

        process.stdout.write(JSON.stringify({
          toolNames: listTools().map((tool) => tool.name),
          exports: {
            createCloudflareClient: typeof createCloudflareClient,
            createNamecheapClient: typeof createNamecheapClient,
            createRailwayClient: typeof createRailwayClient,
            createNpmClient: typeof createNpmClient,
            encodePackageName: encodePackageName("@scope/pkg")
          }
        }));
      `,
        ],
        {
          cwd: projectDir,
        },
      );

      assert.deepEqual(importCheck.toolNames, [
        "cloudflare",
        "namecheap",
        "railway",
        "npm",
      ]);
      assert.deepEqual(importCheck.exports, {
        createCloudflareClient: "function",
        createNamecheapClient: "function",
        createRailwayClient: "function",
        createNpmClient: "function",
        encodePackageName: "%40scope%2Fpkg",
      });
    },
    { packageSpec, timeoutMs, intervalMs },
  );
};

const getPublishedLatestVersion = async (name) => {
  const info = await execJsonCommand("npm", ["view", name, "version", "--json"]);
  return typeof info === "string" ? info : String(info);
};

const waitForPublishedVersion = async ({
  packageName: name,
  version,
  waitTimeoutMs: timeoutMs,
  waitIntervalMs: intervalMs,
}) => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const publishedVersion = await execJsonCommand("npm", [
        "view",
        `${name}@${version}`,
        "version",
        "--json",
      ]);

      if (String(publishedVersion) === version) {
        return;
      }
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }
    }

    console.log(`Waiting for ${name}@${version} to appear on npm...`);
    await sleep(intervalMs);
  }

  throw new Error(`Timed out waiting for ${name}@${version} to become available on npm.`);
};

const execJsonCommand = async (command, commandArgs, options = {}) =>
  JSON.parse((await execCommand(command, commandArgs, options)).stdout);

const withPackageAvailabilityRetry = async (
  action,
  { packageSpec, timeoutMs, intervalMs },
) => {
  const startedAt = Date.now();

  while (true) {
    try {
      return await action();
    } catch (error) {
      if (
        !isTransientPackageAvailabilityError(error) ||
        Date.now() - startedAt >= timeoutMs
      ) {
        throw error;
      }
    }

    console.log(`Waiting for ${packageSpec} to become installable from npm...`);
    await sleep(intervalMs);
  }
};

const isTransientPackageAvailabilityError = (error) => {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes("No matching version found") ||
    error.message.includes("npm error code ETARGET")
  );
};

const execCommand = async (command, commandArgs, { cwd } = {}) => {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
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

    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status: status ?? 1,
        stdout,
        stderr,
      });
    });
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${commandArgs.join(" ")}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  return result;
};

const sleep = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });

await run();
