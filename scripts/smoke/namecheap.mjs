#!/usr/bin/env node
// Real-API smoke for the Namecheap provider.
//
// Namecheap's auth model is fussier than the others: needs API user + API
// key + whitelisted IP. `listDomains` is the canonical canary — auth-required,
// small response, no side effects.
//
// Run via: npm run smoke:namecheap

import {
  createNamecheapClient,
  getNamecheapAuthStatus,
  NamecheapApiError,
} from "../../src/index.mjs";
import { runProviderSmoke } from "./_lib.mjs";

const classifyError = (error) => {
  if (error instanceof NamecheapApiError) {
    const status = error.details?.status;
    if (status === 401 || status === 403) return "auth_invalid";
    // Namecheap returns 200 with error payload for "IP not whitelisted" and
    // similar — keep error_classifier permissive.
    if (/IP|whitelist|allow/i.test(error.message ?? "")) {
      return "scope_insufficient";
    }
  }
  return "api_error";
};

await runProviderSmoke("namecheap", async () => {
  const status = await getNamecheapAuthStatus();
  if (!status?.configured) {
    return {
      reason: "auth_missing",
      instructions: [
        "No Namecheap credentials configured. The smoke needs API user + API",
        "key + whitelisted client IP. Set them up via:",
        "",
        "  node src/cli.mjs connect namecheap",
        "",
        "(or set NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME,",
        " NAMECHEAP_CLIENT_IP in your env)",
        "",
        "Note: your outbound IP MUST be added to Namecheap's API allowlist",
        "at https://ap.www.namecheap.com/settings/tools/apiaccess/whitelisted-ips",
      ].join("\n"),
    };
  }
  console.log(`  → Auth source: ${status.source ?? "env/file"}`);

  const client = createNamecheapClient();
  try {
    const result = await client.listDomains({ pageSize: 5 });
    const domains = result?.domains ?? [];
    console.log(`  → listDomains: ${domains.length} domain(s) visible`);
    return {
      operations: ["getNamecheapAuthStatus", "listDomains"],
      domainCount: domains.length,
    };
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Real API call to listDomains failed.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403: API key invalid or revoked.",
        "If IP/whitelist error: add your outbound IP to Namecheap's allowlist.",
        "  https://ap.www.namecheap.com/settings/tools/apiaccess/whitelisted-ips",
        "",
        "Re-run after fixing:",
        "  node src/cli.mjs connect namecheap",
      ].join("\n"),
      error: String(error?.message ?? error),
    };
  }
});
