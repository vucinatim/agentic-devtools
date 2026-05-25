import assert from "node:assert/strict";
import { test } from "vitest";
import { createAxiomClient } from "../../../src/tools/axiom/client.mjs";

// Tests for dashboard CRUD + granular chart ops. These mock fetch and
// assert: the right URL, method, body shape, and version-handling. The
// real-API behavior is covered by scripts/smoke/axiom.mjs.

const ISOLATED_CONFIG = "/tmp/__axiom_dashboard_test_does_not_exist.json";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

const baseEnv = {
  AXIOM_TOKEN: "xaat-test",
  AXIOM_AUTH_CONFIG_PATH: ISOLATED_CONFIG,
};

// -- createDashboard --------------------------------------------------------

test("createDashboard POSTs to /v2/dashboards with the envelope shape", async () => {
  let captured;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), method: init.method, body: init.body };
      return jsonResponse({
        status: "created",
        dashboard: { id: "dash-1", version: 1 },
      });
    },
  });

  const result = await client.createDashboard({
    name: "Zeroframe default",
    uid: "zero-frame-myapp",
    description: "auto-provisioned",
  });

  assert.equal(captured.method, "POST");
  assert.match(captured.url, /\/v2\/dashboards$/);
  const body = JSON.parse(captured.body);
  assert.equal(body.dashboard.name, "Zeroframe default");
  assert.equal(body.dashboard.uid, "zero-frame-myapp");
  assert.equal(body.dashboard.owner, "X-AXIOM-EVERYONE");
  assert.equal(body.dashboard.schemaVersion, 2);
  // Defaults for time window and refresh
  assert.equal(body.dashboard.refreshTime, 60);
  assert.equal(body.dashboard.timeWindowStart, "qr-now-1h");
  assert.equal(body.dashboard.timeWindowEnd, "qr-now");
  assert.deepEqual(body.dashboard.charts, []);
  assert.deepEqual(body.dashboard.layout, []);
  assert.equal(result.status, "created");
});

test("createDashboard throws when name missing", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    () => client.createDashboard({}),
    /requires \{ name \}/,
  );
});

// -- listDashboards ---------------------------------------------------------

test("listDashboards normalizes array responses", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/v2\/dashboards$/);
      return jsonResponse([
        { id: "d1", uid: "u1", name: "one" },
        { id: "d2", uid: "u2", name: "two" },
      ]);
    },
  });
  const { dashboards } = await client.listDashboards();
  assert.equal(dashboards.length, 2);
  assert.equal(dashboards[0].name, "one");
});

test("listDashboards normalizes object-with-dashboards responses", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () =>
      jsonResponse({ dashboards: [{ id: "d1", name: "one" }] }),
  });
  const { dashboards } = await client.listDashboards();
  assert.equal(dashboards.length, 1);
});

// -- getDashboard / findDashboardByUid --------------------------------------

test("getDashboard GETs /v2/dashboards/{id}", async () => {
  let captured;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), method: init.method };
      return jsonResponse({ dashboard: { id: "abc", version: 3 } });
    },
  });
  const result = await client.getDashboard({ id: "abc" });
  assert.equal(captured.method, "GET");
  assert.match(captured.url, /\/v2\/dashboards\/uid\/abc$/);
  assert.equal(result.dashboard.version, 3);
});

test("findDashboardByUid returns the dashboard on 200", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/v2\/dashboards\/uid\/zero-frame-app2$/);
      return jsonResponse({ id: "d2", uid: "zero-frame-app2", version: 5 });
    },
  });
  const hit = await client.findDashboardByUid({ uid: "zero-frame-app2" });
  assert.equal(hit.id, "d2");
  assert.equal(hit.version, 5);
});

test("findDashboardByUid swallows 404 and returns null", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () =>
      jsonResponse({ message: "dashboard not found" }, 404),
  });
  const miss = await client.findDashboardByUid({ uid: "nope" });
  assert.equal(miss, null);
});

test("findDashboardByUid re-throws non-404 errors (does not silently swallow)", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () =>
      jsonResponse({ message: "server exploded" }, 500),
  });
  await assert.rejects(
    () => client.findDashboardByUid({ uid: "any" }),
    /server exploded/,
  );
});

// -- updateDashboard --------------------------------------------------------

test("updateDashboard PUTs and includes the version envelope", async () => {
  let captured;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), method: init.method, body: init.body };
      return jsonResponse({ status: "updated", dashboard: { version: 2 } });
    },
  });
  await client.updateDashboard({
    id: "abc",
    version: 1,
    name: "renamed",
  });
  assert.equal(captured.method, "PUT");
  assert.match(captured.url, /\/v2\/dashboards\/uid\/abc$/);
  const body = JSON.parse(captured.body);
  assert.equal(body.version, 1);
  assert.equal(body.dashboard.name, "renamed");
});

test("updateDashboard refuses to send without version unless overwrite is set", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    () => client.updateDashboard({ id: "abc", name: "no-version" }),
    /requires \{ version \}/,
  );
});

test("updateDashboard with overwrite skips the version requirement", async () => {
  let captured;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { body: init.body };
      return jsonResponse({});
    },
  });
  await client.updateDashboard({
    id: "abc",
    overwrite: true,
    name: "forced",
  });
  const body = JSON.parse(captured.body);
  assert.equal(body.overwrite, true);
});

// -- deleteDashboard --------------------------------------------------------

test("deleteDashboard DELETEs and returns the id", async () => {
  let captured;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      captured = { url: String(url), method: init.method };
      return jsonResponse("", 200);
    },
  });
  const result = await client.deleteDashboard({ uid: "abc" });
  assert.equal(captured.method, "DELETE");
  assert.match(captured.url, /\/v2\/dashboards\/uid\/abc$/);
  assert.equal(result.deleted, true);
  assert.equal(result.uid, "abc");
});

// -- Granular chart ops -----------------------------------------------------

test("addChart fetches the dashboard, appends, PUTs with same version", async () => {
  const calls = [];
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      if (init.method === "GET") {
        // Real Axiom GET response: version at top level, dashboard nested.
        return jsonResponse({
          version: 7,
          id: "d1",
          uid: "u1",
          dashboard: {
            name: "x",
            charts: [{ id: "old-1", type: "TimeSeries" }],
            layout: [{ i: "old-1", x: 0, y: 0, w: 12, h: 4 }],
          },
        });
      }
      return jsonResponse({ version: 8 });
    },
  });

  await client.addChart({
    dashboardUid: "d1",
    chart: {
      id: "new-chart",
      type: "TimeSeries",
      name: "Auth failures",
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[1].method, "PUT");
  const putBody = JSON.parse(calls[1].body);
  // Granular ops use overwrite:true (see client.mjs comment on int64 precision).
  assert.equal(putBody.overwrite, true);
  assert.equal(putBody.version, undefined);
  assert.equal(putBody.dashboard.charts.length, 2);
  assert.equal(putBody.dashboard.charts[1].id, "new-chart");
  // Layout auto-generated: stacked below existing (y=4 since old-1 was y=0 h=4)
  const newLayout = putBody.dashboard.layout.find((l) => l.i === "new-chart");
  assert.equal(newLayout.y, 4);
  assert.equal(newLayout.w, 12);
});

test("addChart throws when chart lacks id or type", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    () => client.addChart({ dashboardUid: "d1", chart: { type: "TimeSeries" } }),
    /\{ chart: \{ id, type, \.\.\. \} \}/,
  );
  await assert.rejects(
    () => client.addChart({ dashboardUid: "d1", chart: { id: "x" } }),
    /\{ chart: \{ id, type, \.\.\. \} \}/,
  );
});

test("updateChart merges partial fields into the matching chart", async () => {
  let putBody;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") {
        return jsonResponse({
          version: 2,
          dashboard: {
            charts: [
              { id: "c1", type: "TimeSeries", name: "old" },
              { id: "c2", type: "TimeSeries", name: "other" },
            ],
            layout: [],
          },
        });
      }
      putBody = JSON.parse(init.body);
      return jsonResponse({});
    },
  });

  await client.updateChart({
    dashboardUid: "d1",
    chartId: "c1",
    name: "renamed",
  });

  assert.equal(putBody.overwrite, true);
  const updated = putBody.dashboard.charts.find((c) => c.id === "c1");
  assert.equal(updated.name, "renamed");
  // Other chart untouched
  const other = putBody.dashboard.charts.find((c) => c.id === "c2");
  assert.equal(other.name, "other");
});

test("updateChart throws when chartId not found", async () => {
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async () =>
      jsonResponse({
        version: 1,
        dashboard: { charts: [{ id: "c1", type: "x" }] },
      }),
  });
  await assert.rejects(
    () =>
      client.updateChart({
        dashboardUid: "d1",
        chartId: "missing",
        name: "x",
      }),
    /no chart with id "missing"/,
  );
});

test("removeChart filters both charts and layout entries", async () => {
  let putBody;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") {
        return jsonResponse({
          version: 3,
          dashboard: {
            charts: [
              { id: "a", type: "TimeSeries" },
              { id: "b", type: "TimeSeries" },
            ],
            layout: [
              { i: "a", x: 0, y: 0, w: 12, h: 4 },
              { i: "b", x: 0, y: 4, w: 12, h: 4 },
            ],
          },
        });
      }
      putBody = JSON.parse(init.body);
      return jsonResponse({});
    },
  });

  await client.removeChart({ dashboardUid: "d1", chartId: "a" });

  assert.equal(putBody.dashboard.charts.length, 1);
  assert.equal(putBody.dashboard.charts[0].id, "b");
  assert.equal(putBody.dashboard.layout.length, 1);
  assert.equal(putBody.dashboard.layout[0].i, "b");
});

test("removeChart no-ops cleanly when chartId is absent", async () => {
  let putBody;
  const client = createAxiomClient({
    env: baseEnv,
    fetchImpl: async (_url, init) => {
      if (init.method === "GET") {
        return jsonResponse({
          version: 1,
          dashboard: {
            charts: [{ id: "only-one", type: "TimeSeries" }],
            layout: [],
          },
        });
      }
      putBody = JSON.parse(init.body);
      return jsonResponse({});
    },
  });

  await client.removeChart({ dashboardUid: "d1", chartId: "ghost" });

  assert.equal(putBody.dashboard.charts.length, 1);
});
