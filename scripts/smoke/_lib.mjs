// Shared scaffolding for per-provider smoke scripts.
//
// Every smoke writes a single .smoke/<provider>.json receipt. The receipt
// records ok/reason + the source hash at the time of the smoke. The
// pre-publish gate later verifies ok === true AND the hash still matches.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { REPO_ROOT, hashProviderSources } from "../lib/providers.mjs";

export const receiptPathFor = (provider) =>
  join(REPO_ROOT, ".smoke", `${provider}.json`);

const writeReceipt = (provider, body) => {
  const path = receiptPathFor(provider);
  const receipt = {
    provider,
    ranAt: new Date().toISOString(),
    inputHash: hashProviderSources(provider),
    ...body,
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`);
  return receipt;
};

/**
 * Run a provider smoke. The `run` callback returns an object describing the
 * successful smoke (operations, summary fields). If it throws or returns a
 * `{ reason, instructions }` failure object, we write a failure receipt and
 * exit non-zero. Either way a receipt is produced — the only way no receipt
 * exists is if the script itself crashed before this helper ran.
 */
export const runProviderSmoke = async (provider, run) => {
  console.log(`Real-API smoke — ${provider}`);
  try {
    const result = await run();
    if (result && result.reason) {
      writeReceipt(provider, { ok: false, ...result });
      console.error(`\n✗ ${provider} smoke FAILED (${result.reason})\n`);
      console.error(String(result.instructions ?? "").replace(/^/gm, "  "));
      console.error("");
      process.exit(1);
    }
    writeReceipt(provider, { ok: true, ...(result ?? {}) });
    console.log(`\n✓ ${provider} smoke PASSED. Receipt: .smoke/${provider}.json`);
  } catch (error) {
    writeReceipt(provider, {
      ok: false,
      reason: "api_error",
      instructions: [
        "Unexpected error during smoke.",
        `Error: ${error?.message ?? error}`,
      ].join("\n"),
      error: String(error?.message ?? error),
    });
    console.error(`\n✗ ${provider} smoke FAILED (unexpected error)\n`);
    console.error(String(error?.message ?? error).replace(/^/gm, "  "));
    console.error("");
    process.exit(1);
  }
};
