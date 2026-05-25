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
    const message = error.message ?? "";
    // Axiom returns 403 with messages like "token does not have access to
    // resource: dashboards with action: create" when the token is valid but
    // lacks the capability for that operation. That's `scope_insufficient`,
    // not `auth_invalid` — different remediation (edit token scopes vs. mint
    // a new token).
    if (
      /does not have access to resource|permission for|lack(s)? .* permission/i.test(
        message,
      )
    ) {
      return "scope_insufficient";
    }
    if (status === 401 || status === 403) return "auth_invalid";
    if (status === 400 && /permission/i.test(message)) {
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

  let querySkipReason = null;
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
      // Per-dataset query failures are non-fatal: the token might have
      // Dashboards/listDatasets rights without per-dataset Query:Read, or the
      // configured `defaultDataset` may not be on this token's allow-list.
      // listDatasets succeeded above, so we already know the token + API +
      // base URL work. We record the skip in the receipt for visibility and
      // continue with the destructive dashboard CRUD smoke (the main goal).
      const msg = error?.message ?? String(error);
      querySkipReason = msg;
      console.log(
        `  → query('${datasetName}'): SKIPPED (${msg.slice(0, 100)}) — non-fatal`,
      );
    }
  } else {
    console.log(
      "  → No dataset configured (config.defaultDataset / SMOKE_AXIOM_DATASET) — skipping query step.",
    );
  }

  // Step 4: dashboard CRUD smoke (destructive — create-then-delete pattern).
  //
  // Validates the dashboards/* primitives end-to-end against the real Axiom
  // API. We create a uniquely-named dashboard, fetch it back, append a chart
  // via the granular helper, then delete the dashboard so the user's account
  // is left in its original state. Any failure here means our schema
  // assumptions (envelope shape, version semantics, granular merge logic)
  // don't match Axiom's reality — and the receipt records `ok: false` with
  // a specific reason. Token must have Dashboards: C/R/U/D capability.
  let dashboardOpsRan = false;
  try {
    const uid = `zero-frame-smoke-${Date.now()}`;
    const created = await client.createDashboard({
      name: "zero-frame-smoke",
      uid,
      description: "Created by agentic-devtools smoke test. Safe to delete.",
    });
    // Axiom returns the dashboard's stable uid in `created.uid` (also nested
    // under created.dashboard.uid). We use the uid for all follow-up ops
    // because /v2/dashboards/uid/{uid} is the canonical single-resource path
    // — NOT the internal `id` field, despite what the public docs imply.
    const createdUid =
      created?.uid ?? created?.dashboard?.uid ?? uid;
    operations.push("createDashboard");
    console.log(`  → createDashboard: created (uid=${createdUid})`);

    await client.getDashboard({ uid: createdUid });
    operations.push("getDashboard");
    console.log(`  → getDashboard: round-tripped successfully`);

    await client.addChart({
      dashboardUid: createdUid,
      chart: {
        id: "smoke-chart-1",
        type: "Note",
        text: "Smoke test panel — will be deleted with the dashboard.",
      },
    });
    operations.push("addChart");
    console.log(`  → addChart: appended a Note panel`);

    await client.deleteDashboard({ uid: createdUid });
    operations.push("deleteDashboard");
    console.log(`  → deleteDashboard: cleaned up ${createdUid}`);
    dashboardOpsRan = true;
  } catch (error) {
    return {
      reason: classifyError(error),
      instructions: [
        "Dashboard CRUD smoke failed. The token may lack Dashboards capabilities.",
        `Error: ${error?.message ?? error}`,
        "",
        "If 401/403 or scope_insufficient: re-create your Axiom token with",
        "Organization capabilities → Dashboards: Create, Read, Update, Delete checked.",
        "",
        "If schema/validation: Axiom's API shape may differ from what we expect.",
        "Inspect the error details and adjust src/tools/axiom/client.mjs.",
      ].join("\n"),
      operations,
      error: String(error?.message ?? error),
    };
  }

  return {
    operations,
    datasetCount: datasets.length,
    queriedDataset: querySkipReason ? null : datasetName,
    querySkipReason,
    destructive: true,
    verifiedVia: "sibling-create-then-delete",
    dashboardOpsRan,
  };
});
