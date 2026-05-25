// Shared provider metadata for smoke scripts and pre-publish gate.
//
// Single source of truth: when a new provider is added under src/tools/<name>/,
// extend PROVIDERS here. The pre-publish gate uses this list to detect touched
// providers from a git diff and to require a matching .smoke/<name>.json receipt.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..");

export const PROVIDERS = ["cloudflare", "namecheap", "railway", "npm", "axiom"];

// Genuinely cross-cutting: a change anywhere under here affects every
// provider's runtime (shared error mapping, tool registry, config store, etc).
// Forces a re-smoke for ALL providers.
export const CROSS_CUTTING_FILES = [];
export const CROSS_CUTTING_DIRS = ["src/core/"];

// "Dispatcher" files — flat per-provider branches that don't share execution
// paths across providers. We scan the diff of these files for provider names
// to figure out which branches actually changed.
const DISPATCHER_FILES = ["src/cli.mjs", "src/index.mjs"];

/**
 * Detect which providers are touched by a set of changed file paths.
 *
 * `getDispatcherDiff(file)` is an optional callback returning the textual diff
 * for one of the DISPATCHER_FILES. When available we scan the diff for
 * provider-name word matches; only the providers actually mentioned in the
 * diff are marked touched. When absent we fall back to the conservative
 * "all providers" interpretation.
 */
export const detectTouchedProviders = (
  changedFiles,
  getDispatcherDiff = null,
) => {
  const isCrossCutting = changedFiles.some(
    (file) =>
      CROSS_CUTTING_FILES.includes(file) ||
      CROSS_CUTTING_DIRS.some((dir) => file.startsWith(dir)),
  );
  if (isCrossCutting) {
    return new Set(PROVIDERS);
  }

  const touched = new Set();
  for (const file of changedFiles) {
    for (const provider of PROVIDERS) {
      if (file.startsWith(`src/tools/${provider}/`)) {
        touched.add(provider);
      }
    }
    if (DISPATCHER_FILES.includes(file)) {
      if (!getDispatcherDiff) {
        // No diff source — be conservative.
        return new Set(PROVIDERS);
      }
      const diff = getDispatcherDiff(file);
      for (const provider of PROVIDERS) {
        // Match the literal provider name on a word boundary. Dispatcher
        // diffs always reference branches by the lowercase provider name
        // (e.g. `if (toolName === "axiom")`).
        if (new RegExp(`\\b${provider}\\b`).test(diff)) {
          touched.add(provider);
        }
      }
    }
  }
  return touched;
};

const walkFiles = (root) => {
  if (!existsSync(root)) return [];
  const results = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      results.push(...walkFiles(full));
    } else {
      results.push(full);
    }
  }
  return results;
};

/**
 * Compute a deterministic hash of all source files that influence a provider's
 * runtime behavior: the provider's own tools dir + every cross-cutting file.
 *
 * Smoke scripts embed this hash in their receipt; the pre-publish gate
 * recomputes it at check time. A mismatch means the source changed since the
 * smoke ran — receipt is stale, gate fails.
 */
export const hashProviderSources = (provider) => {
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`Unknown provider: ${provider}`);
  }
  const inputs = [
    ...walkFiles(join(REPO_ROOT, "src", "tools", provider)),
    ...CROSS_CUTTING_FILES.map((file) => join(REPO_ROOT, file)).filter((file) =>
      existsSync(file),
    ),
    ...CROSS_CUTTING_DIRS.flatMap((dir) => walkFiles(join(REPO_ROOT, dir))),
  ]
    .map((file) => relative(REPO_ROOT, file))
    .sort();

  const hash = createHash("sha256");
  for (const relPath of inputs) {
    hash.update(relPath);
    hash.update("\0");
    hash.update(readFileSync(join(REPO_ROOT, relPath)));
    hash.update("\0");
  }
  return hash.digest("hex");
};
