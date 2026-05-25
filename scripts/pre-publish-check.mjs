#!/usr/bin/env node
// Gate 2 — Pre-publish receipt check.
//
// For every provider whose source files changed since the last published
// release, require a corresponding fresh receipt at .smoke/<provider>.json.
// "Fresh" means: ok === true AND the receipt's inputHash matches the current
// hash of the provider's source (tools dir + cross-cutting files).
//
// This forces the developer (human or agent) to actually run the real-API
// smoke for every provider they touched, against the exact code they're
// shipping, before the publish workflow can succeed.
//
// What this gate is NOT: a test runner. It only verifies that smokes ran.
// The smokes themselves are in scripts/smoke/<provider>.mjs and must be
// invoked locally (CI never has prod creds).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import {
  PROVIDERS,
  REPO_ROOT,
  detectTouchedProviders,
  hashProviderSources,
} from "./lib/providers.mjs";

const SMOKE_DIR = join(REPO_ROOT, ".smoke");

const die = (message, instructions = null) => {
  console.error(`\n✗ Pre-publish gate FAILED\n`);
  console.error(`  ${message}`);
  if (instructions) {
    console.error(`\n  How to fix:\n${instructions.replace(/^/gm, "    ")}`);
  }
  console.error("");
  process.exit(1);
};

const findLastReleaseTag = () => {
  try {
    return execSync("git describe --tags --abbrev=0", {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};

const getChangedFilesSince = (reference) => {
  // If no prior tag, treat every provider as touched — first publish is a
  // smoke-everything event.
  if (!reference) {
    const tracked = execSync("git ls-files src/", {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    return tracked.split("\n").filter(Boolean);
  }
  // Three sources of "changed since tag":
  //   1. Committed changes from <tag>..HEAD
  //   2. Uncommitted tracked changes (working tree vs HEAD)
  //   3. Untracked files not yet added
  // Union all three so the gate fires for any local edit, not just commits.
  const committed = execSync(`git diff --name-only ${reference}..HEAD`, {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const uncommitted = execSync("git diff --name-only HEAD", {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const untracked = execSync(
    "git ls-files --others --exclude-standard",
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return [...new Set(
    [committed, uncommitted, untracked]
      .flatMap((output) => output.split("\n"))
      .filter(Boolean),
  )];
};

const loadReceipt = (provider) => {
  const path = join(SMOKE_DIR, `${provider}.json`);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(
      `Receipt at .smoke/${provider}.json is not valid JSON (${error.message}).`,
      `Re-run: npm run smoke:${provider}`,
    );
    return null;
  }
};

const verifyReceipt = (provider) => {
  const receipt = loadReceipt(provider);
  if (!receipt) {
    die(
      `Missing smoke receipt for provider "${provider}" — .smoke/${provider}.json does not exist.`,
      `Run the real-API smoke before publishing:\nnpm run smoke:${provider}\n\nThis will exercise the provider against a real account and write\nthe receipt that this gate requires.`,
    );
  }
  if (receipt.provider !== provider) {
    die(
      `Receipt .smoke/${provider}.json has wrong provider field: "${receipt.provider}".`,
      `Re-run: npm run smoke:${provider}`,
    );
  }
  if (receipt.ok !== true) {
    die(
      `Smoke for "${provider}" recorded ok=false (reason: ${receipt.reason ?? "unknown"}).`,
      receipt.instructions ??
        `Fix the underlying issue and re-run:\nnpm run smoke:${provider}`,
    );
  }
  const currentHash = hashProviderSources(provider);
  if (receipt.inputHash !== currentHash) {
    die(
      `Smoke receipt for "${provider}" is stale — source changed since the smoke ran.`,
      `Receipt hash:  ${receipt.inputHash}\nCurrent hash:  ${currentHash}\n\nRe-run: npm run smoke:${provider}`,
    );
  }
};

const run = () => {
  console.log("Gate 2 — Pre-publish receipt check");
  const lastTag = findLastReleaseTag();
  console.log(
    `  → Diffing against ${lastTag ? `last release tag (${lastTag})` : "git history root (no prior tag)"}...`,
  );

  const changedFiles = getChangedFilesSince(lastTag);

  // For dispatcher files we need the diff text to figure out which provider
  // branches changed. We combine `<tag>..HEAD` (committed) with
  // `git diff HEAD` (uncommitted) so locally-staged Path B work counts too.
  //
  // Use --unified=0 to suppress context lines: a context line that happens to
  // contain "npm" from the usage banner does NOT mean the npm provider was
  // touched. Only added/removed lines count.
  const getDispatcherDiff = (file) => {
    const committed = lastTag
      ? execSync(`git diff --unified=0 ${lastTag}..HEAD -- ${file}`, {
          cwd: REPO_ROOT,
          encoding: "utf8",
        })
      : "";
    const uncommitted = execSync(`git diff --unified=0 HEAD -- ${file}`, {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    // Strip file-header lines (+++ / ---) which don't reflect content.
    const stripHeaders = (text) =>
      text
        .split("\n")
        .filter(
          (line) =>
            (line.startsWith("+") || line.startsWith("-")) &&
            !line.startsWith("+++") &&
            !line.startsWith("---"),
        )
        .join("\n");
    return stripHeaders(committed) + "\n" + stripHeaders(uncommitted);
  };

  const touched = detectTouchedProviders(changedFiles, getDispatcherDiff);

  if (touched.size === 0) {
    console.log("  → No provider source changed. Nothing to verify.");
    console.log("Gate 2 PASSED.");
    return;
  }

  console.log(`  → Touched providers: ${[...touched].sort().join(", ")}`);
  for (const provider of [...touched].sort()) {
    verifyReceipt(provider);
    console.log(`    ✓ ${provider}: fresh receipt`);
  }
  console.log("Gate 2 PASSED — every touched provider has a fresh smoke receipt.");
};

run();
