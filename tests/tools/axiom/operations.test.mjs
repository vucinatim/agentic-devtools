import assert from "node:assert/strict";
import { test } from "vitest";
import { axiomOperations } from "../../../src/tools/axiom/operations.mjs";

// Snapshot of the data-operation surface. This is the safety net for the
// shared-registry refactor: if an extraction ever drops or renames an op,
// these assertions fail. The 4 auth/diagnostic tools (getAxiomAuthStatus,
// connectAxiom, disconnectAxiom, testAxiomConnection) are registered
// separately in mcp.mjs and are intentionally NOT in this registry.

const EXPECTED = [
  ["list-datasets", "listAxiomDatasets"],
  ["get-dataset", "getAxiomDataset"],
  ["query", "queryAxiom"],
  ["recent-errors", "axiomRecentErrors"],
  ["get-trace", "axiomGetTraceById"],
  ["list-dashboards", "axiomListDashboards"],
  ["get-dashboard", "axiomGetDashboard"],
  ["find-dashboard", "axiomFindDashboardByUid"],
  ["create-dashboard", "axiomCreateDashboard"],
  ["update-dashboard", "axiomUpdateDashboard"],
  ["delete-dashboard", "axiomDeleteDashboard"],
  ["add-chart", "axiomAddChart"],
  ["update-chart", "axiomUpdateChart"],
  ["remove-chart", "axiomRemoveChart"],
];

test("axiom operations registry has the exact expected (cliName, mcpName) set", () => {
  const actual = axiomOperations.map((op) => [op.cliName, op.mcpName]);
  assert.deepEqual(actual, EXPECTED);
});

test("every axiom operation is well-formed", () => {
  for (const op of axiomOperations) {
    assert.equal(typeof op.cliName, "string", `${op.mcpName} cliName`);
    assert.equal(typeof op.mcpName, "string", `${op.cliName} mcpName`);
    assert.equal(typeof op.description, "string", `${op.cliName} description`);
    assert.equal(typeof op.handler, "function", `${op.cliName} handler`);
    assert.equal(typeof op.parseArgs, "function", `${op.cliName} parseArgs`);
  }
});

test("cliNames and mcpNames are unique", () => {
  const cliNames = new Set(axiomOperations.map((o) => o.cliName));
  const mcpNames = new Set(axiomOperations.map((o) => o.mcpName));
  assert.equal(cliNames.size, axiomOperations.length, "duplicate cliName");
  assert.equal(mcpNames.size, axiomOperations.length, "duplicate mcpName");
});

test("handlers delegate to the injected client (no hidden client construction)", async () => {
  // Each handler should call client.<method>(args). Verify by passing a fake
  // client that records the call — proves the handler uses extra.client.
  const calls = [];
  const fakeClient = new Proxy(
    {},
    {
      get:
        (_t, method) =>
        (...args) => {
          calls.push({ method, args });
          return { ok: true };
        },
    },
  );
  for (const op of axiomOperations) {
    calls.length = 0;
    await op.handler({ probe: true }, { client: fakeClient });
    assert.equal(calls.length, 1, `${op.cliName} should call client once`);
  }
});
