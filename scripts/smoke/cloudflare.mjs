#!/usr/bin/env node
// Real-API smoke for the Cloudflare provider.
//
// Validates the working client (the one used by every MCP tool) against the
// real Cloudflare API. We don't smoke the bootstrap-mint path here — that
// flow is exercised whenever you re-mint a working token; the daily-driver
// path is the working client itself, and that's what runtime depends on.
//
// Run via: npm run smoke:cloudflare

import {
  CloudflareApiError,
  createCloudflareClient,
  getCloudflareAuthStatus,
} from "../../src/index.mjs";
import { runProviderSmoke } from "./_lib.mjs";

const classifyError = (error) => {
  if (error instanceof CloudflareApiError) {
    const status = error.details?.status;
    if (status === 401 || status === 403) return "auth_invalid";
  }
  return "api_error";
};

await runProviderSmoke("cloudflare", async () => {
  const status = getCloudflareAuthStatus();
  if (!status.configured) {
    return {
      reason: "auth_missing",
      instructions: [
        "No Cloudflare working token configured. The smoke needs a token that",
        "can hit GET /accounts. Set one up via:",
        "",
        "  node src/cli.mjs connect cloudflare",
        "",
        "(or set CLOUDFLARE_API_TOKEN in your env)",
      ].join("\n"),
    };
  }
  console.log(`  → Auth source: ${status.source}`);

  const client = createCloudflareClient();
  try {
    const result = await client.listAccounts();
    const accounts = result?.result ?? result?.accounts ?? [];
    console.log(`  → listAccounts: ${accounts.length} account(s) visible`);
    return {
      operations: ["getCloudflareAuthStatus", "listAccounts"],
      accountCount: accounts.length,
    };
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Real API call to GET /accounts failed.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403: token is invalid, revoked, or lacks the required scope.",
        "Re-run: node src/cli.mjs connect cloudflare",
      ].join("\n"),
      error: String(error?.message ?? error),
    };
  }
});
