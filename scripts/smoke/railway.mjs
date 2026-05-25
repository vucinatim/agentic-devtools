#!/usr/bin/env node
// Real-API smoke for the Railway provider.
//
// Hits the real Railway GraphQL API with the saved working token (project
// token if one is set, else the personal API token from the bootstrap). Uses
// listProjects as the canary — small payload, exercises auth + base URL.
//
// Run via: npm run smoke:railway

import {
  createRailwayClient,
  getRailwayAuthStatus,
  RailwayApiError,
} from "../../src/index.mjs";
import { runProviderSmoke } from "./_lib.mjs";

const classifyError = (error) => {
  if (error instanceof RailwayApiError) {
    const status = error.details?.status;
    if (status === 401 || status === 403) return "auth_invalid";
  }
  return "api_error";
};

await runProviderSmoke("railway", async () => {
  const status = getRailwayAuthStatus();
  if (!status.configured) {
    return {
      reason: "auth_missing",
      instructions: [
        "No Railway token configured. The smoke needs a token to call the API.",
        "Set one up via:",
        "",
        "  node src/cli.mjs connect railway",
        "",
        "(or set RAILWAY_API_TOKEN / RAILWAY_PROJECT_TOKEN in your env)",
      ].join("\n"),
    };
  }
  console.log(`  → Auth source: ${status.source}`);

  const client = createRailwayClient();
  try {
    const result = await client.listProjects({ first: 5 });
    const projects = result?.projects ?? [];
    console.log(`  → listProjects: ${projects.length} project(s) visible`);
    return {
      operations: ["getRailwayAuthStatus", "listProjects"],
      projectCount: projects.length,
    };
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Real API call to listProjects failed.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403: token is invalid or revoked. Re-run:",
        "  node src/cli.mjs connect railway",
      ].join("\n"),
      error: String(error?.message ?? error),
    };
  }
});
