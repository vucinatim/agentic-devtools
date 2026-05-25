import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createAxiomClient,
  toIsoTimestamp,
} from "../../../src/tools/axiom/client.mjs";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

// -- toIsoTimestamp ----------------------------------------------------------

test("toIsoTimestamp converts '1h' relative to ISO in the past", () => {
  const now = () => Date.parse("2026-01-01T12:00:00.000Z");
  const result = toIsoTimestamp("1h", { now });
  assert.equal(result, "2026-01-01T11:00:00.000Z");
});

test("toIsoTimestamp converts '30m', '7d', '45s' correctly", () => {
  const now = () => Date.parse("2026-01-01T12:00:00.000Z");
  assert.equal(toIsoTimestamp("30m", { now }), "2026-01-01T11:30:00.000Z");
  assert.equal(toIsoTimestamp("7d", { now }), "2025-12-25T12:00:00.000Z");
  assert.equal(toIsoTimestamp("45s", { now }), "2026-01-01T11:59:15.000Z");
});

test("toIsoTimestamp passes ISO strings through unchanged", () => {
  assert.equal(
    toIsoTimestamp("2025-12-01T08:30:00.000Z"),
    "2025-12-01T08:30:00.000Z",
  );
});

test("toIsoTimestamp accepts unix-ms numbers", () => {
  assert.equal(toIsoTimestamp(0), "1970-01-01T00:00:00.000Z");
});

test("toIsoTimestamp returns null for nullish", () => {
  assert.equal(toIsoTimestamp(null), null);
  assert.equal(toIsoTimestamp(undefined), null);
  assert.equal(toIsoTimestamp(""), null);
});

// -- Auth status -------------------------------------------------------------

test("createAxiomClient honours AXIOM_TOKEN from env", async () => {
  const client = createAxiomClient({
    env: {
      AXIOM_TOKEN: "xaat-test",
      AXIOM_DATASET: "my-app-prod",
    },
    fetchImpl: async () => jsonResponse([]),
  });

  assert.equal(client.auth.source, "env:AXIOM_TOKEN");
  assert.equal(client.auth.defaultDataset, "my-app-prod");
});

test("createAxiomClient throws on missing token before any HTTP call", async () => {
  const client = createAxiomClient({
    env: {},
    fetchImpl: async () => {
      throw new Error("fetch should not be called when token is missing");
    },
  });

  await assert.rejects(
    () => client.listDatasets(),
    /Missing Axiom API token/,
  );
});

// -- listDatasets ------------------------------------------------------------

test("listDatasets unwraps array-shaped responses", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async () =>
      jsonResponse([
        { name: "my-app-prod", description: "prod logs" },
        { name: "my-app-staging" },
      ]),
  });

  const { datasets } = await client.listDatasets();
  assert.equal(datasets.length, 2);
  assert.equal(datasets[0].name, "my-app-prod");
});

test("listDatasets unwraps { datasets } object-shaped responses", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async () =>
      jsonResponse({
        datasets: [{ name: "a" }, { name: "b" }, { name: "c" }],
      }),
  });
  const { datasets } = await client.listDatasets();
  assert.equal(datasets.length, 3);
});

// -- query -------------------------------------------------------------------

test("query POSTs APL with startTime/endTime conversion", async () => {
  const calls = [];
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      return jsonResponse({
        matches: [{ _time: "2026-01-01T00:00:00Z", msg: "hi" }],
        tables: [{ name: "matches", columns: [] }],
        status: { elapsedTime: 12 },
      });
    },
  });

  const now = () => Date.parse("2026-01-01T12:00:00.000Z");
  const result = await client.query({
    apl: "['my-app'] | order by _time desc | limit 5",
    startTime: "1h",
    endTime: "2026-01-01T13:00:00Z",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v1\/datasets\/_apl\?format=legacy$/);
  const body = JSON.parse(calls[0].body);
  assert.match(body.apl, /my-app/);
  // The relative startTime conversion uses the real Date.now at runtime; we
  // just check it's an ISO string.
  assert.match(body.startTime, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.endTime, "2026-01-01T13:00:00Z");

  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].msg, "hi");
  assert.equal(result.status.elapsedTime, 12);
});

test("query throws when apl is missing", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(() => client.query({}), /requires \{ apl/);
});

// -- recentErrors ------------------------------------------------------------

test("recentErrors builds an APL query against the configured dataset", async () => {
  const calls = [];
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t", AXIOM_DATASET: "my-app-prod" },
    fetchImpl: async (url, init) => {
      calls.push({ body: init.body });
      return jsonResponse({ matches: [] });
    },
  });

  await client.recentErrors({ window: "2h", limit: 50 });
  const body = JSON.parse(calls[0].body);
  assert.match(body.apl, /'my-app-prod'/);
  assert.match(body.apl, /limit 50/);
  assert.match(body.apl, /order by _time desc/);
});

test("recentErrors throws when no dataset is set or supplied", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" }, // no AXIOM_DATASET
    fetchImpl: async () => jsonResponse({ matches: [] }),
  });
  await assert.rejects(
    () => client.recentErrors({}),
    /requires \{ dataset \}/,
  );
});

// -- getTraceById ------------------------------------------------------------

test("getTraceById filters APL by traceId across last 7d", async () => {
  const calls = [];
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t", AXIOM_DATASET: "ds" },
    fetchImpl: async (url, init) => {
      calls.push({ body: init.body });
      return jsonResponse({ matches: [] });
    },
  });
  await client.getTraceById({ traceId: "abc123" });
  const body = JSON.parse(calls[0].body);
  assert.match(body.apl, /'ds'/);
  assert.match(body.apl, /trace_id.*abc123|traceId.*abc123/);
  // startTime should be ~7 days ago
  assert.match(body.startTime, /^\d{4}-\d{2}-\d{2}T/);
});

test("getTraceById escapes apostrophes in dataset name", async () => {
  const calls = [];
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t", AXIOM_DATASET: "foo's-ds" },
    fetchImpl: async (url, init) => {
      calls.push({ body: init.body });
      return jsonResponse({ matches: [] });
    },
  });
  await client.getTraceById({ traceId: "tid" });
  const body = JSON.parse(calls[0].body);
  // The single-quote in dataset must be escaped so it doesn't break APL.
  assert.match(body.apl, /foo\\'s-ds/);
});

// -- Error surfacing ---------------------------------------------------------

test("non-2xx responses throw AxiomApiError with status + payload", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async () => jsonResponse({ message: "Forbidden" }, 403),
  });
  await assert.rejects(
    () => client.listDatasets(),
    (err) => {
      assert.equal(err.name, "AxiomApiError");
      assert.equal(err.details.status, 403);
      assert.equal(err.message, "Forbidden");
      return true;
    },
  );
});

test("text-only error responses still produce a usable message", async () => {
  const client = createAxiomClient({
    env: { AXIOM_TOKEN: "t" },
    fetchImpl: async () => jsonResponse("internal error string", 500),
  });
  await assert.rejects(
    () => client.listDatasets(),
    (err) => {
      assert.equal(err.name, "AxiomApiError");
      assert.equal(err.details.status, 500);
      assert.ok(err.message.length > 0);
      return true;
    },
  );
});
