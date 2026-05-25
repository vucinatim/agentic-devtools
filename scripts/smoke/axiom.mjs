#!/usr/bin/env node
// Real-API smoke for the Axiom provider.
//
// Exercises the full stack against a real Axiom account:
//   1. Resolve the saved auth config (catches file-read bugs unit tests miss)
//   2. Hit GET /v1/datasets with the resolved token (auth + base URL works)
//   3. If a default dataset is set, run a 1-row APL query (dataset scope works)
//
// Run via:    npm run smoke:axiom
// Override:   SMOKE_AXIOM_DATASET=my-dataset npm run smoke:axiom

import {
  AxiomApiError,
  createAxiomClient,
  getAxiomAuthStatus,
  resolveAxiomAuthConfig,
} from "../../src/index.mjs";
import { runProviderSmoke } from "./_lib.mjs";

const classifyError = (error) => {
  if (error instanceof AxiomApiError) {
    const status = error.details?.status;
    if (status === 401 || status === 403) return "auth_invalid";
    if (status === 400 && /permission/i.test(error.message)) {
      return "scope_insufficient";
    }
  }
  return "api_error";
};

await runProviderSmoke("axiom", async () => {
  // Step 1: config resolution
  const status = getAxiomAuthStatus();
  if (!status.configured) {
    return {
      reason: "auth_missing",
      instructions: [
        "No Axiom token configured. The smoke needs a saved token to exercise",
        "the real API. Set one up via either:",
        "",
        "  • Run the connect flow:",
        "      node src/cli.mjs connect axiom",
        "",
        "  • Or export env vars:",
        "      AXIOM_TOKEN=xaat-... AXIOM_DATASET=<your-dataset> npm run smoke:axiom",
        "",
        "The token needs Query:read on the dataset you smoke against.",
      ].join("\n"),
    };
  }

  const config = resolveAxiomAuthConfig();
  console.log(`  → Auth source: ${status.source}`);

  // Step 2: list datasets — proves token + base URL work end-to-end
  const client = createAxiomClient();
  const operations = ["resolveAxiomAuthConfig"];
  let datasets;
  try {
    const result = await client.listDatasets();
    datasets = result.datasets;
    operations.push("listDatasets");
    console.log(`  → listDatasets: ${datasets.length} dataset(s) visible`);
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Real API call to GET /v1/datasets failed.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403: token is invalid or revoked. Re-run `connect axiom`.",
        "If 400: token may have wrong scopes. Re-create with Query:read.",
        "If network: check connectivity to https://api.axiom.co.",
      ].join("\n"),
      error: String(error?.message ?? error),
    };
  }

  // Step 3: query a real dataset, if one is configured
  const datasetName =
    process.env.SMOKE_AXIOM_DATASET ?? config.defaultDataset ?? null;

  if (datasetName) {
    try {
      const queryResult = await client.query({
        apl: `['${datasetName}'] | limit 1`,
        startTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date().toISOString(),
      });
      operations.push(`query(${datasetName})`);
      const rowCount = queryResult.matches?.length ?? 0;
      console.log(
        `  → query('${datasetName}'): ${rowCount} row(s) in last 24h`,
      );
    } catch (error) {
      return {
        reason: classifyError(error),
        instructions: [
          `Query against dataset "${datasetName}" failed.`,
          `Error: ${error?.message ?? error}`,
          "",
          "If 400 with 'permission': token lacks Query:read on this dataset.",
          "If 404: dataset name is wrong.",
          "Re-create the token in Axiom dashboard with Query:read on this dataset.",
        ].join("\n"),
        dataset: datasetName,
        error: String(error?.message ?? error),
      };
    }
  } else {
    console.log(
      "  → No dataset configured (config.defaultDataset / SMOKE_AXIOM_DATASET) — skipping query step.",
    );
  }

  return {
    operations,
    datasetCount: datasets.length,
    queriedDataset: datasetName,
  };
});
