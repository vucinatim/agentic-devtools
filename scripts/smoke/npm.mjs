#!/usr/bin/env node
// Real-API smoke for the npm provider.
//
// Hits npm's registry with the saved token to verify auth works. `whoami`
// is the canonical ping endpoint — small response, exercises auth header
// + base URL construction without side effects.
//
// Run via: npm run smoke:npm

import {
  createNpmClient,
  getNpmAuthStatus,
  NpmRegistryError,
} from "../../src/index.mjs";
import { runProviderSmoke } from "./_lib.mjs";

const classifyError = (error) => {
  if (error instanceof NpmRegistryError) {
    const status = error.details?.status;
    if (status === 401 || status === 403) return "auth_invalid";
  }
  return "api_error";
};

await runProviderSmoke("npm", async () => {
  const status = getNpmAuthStatus();
  if (!status.configured) {
    return {
      reason: "auth_missing",
      instructions: [
        "No npm token configured. The smoke needs a token to call the registry.",
        "Set one up via:",
        "",
        "  node src/cli.mjs connect npm",
        "",
        "(or set NPM_TOKEN / NODE_AUTH_TOKEN in your env)",
      ].join("\n"),
    };
  }
  console.log(`  → Auth source: ${status.source}`);
  console.log(`  → Registry:    ${status.registry}`);

  const client = createNpmClient();
  try {
    const result = await client.getCurrentUser();
    const username = result?.username ?? result?.name ?? null;
    console.log(`  → whoami: ${username ?? "(no username in response)"}`);
    return {
      operations: ["getNpmAuthStatus", "getCurrentUser"],
      username,
      registry: status.registry,
    };
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Real API call to /-/whoami failed.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403: token is invalid or revoked. Re-run:",
        "  node src/cli.mjs connect npm",
      ].join("\n"),
      error: String(error?.message ?? error),
    };
  }
});
