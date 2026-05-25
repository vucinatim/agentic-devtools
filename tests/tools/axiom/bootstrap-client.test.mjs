import assert from "node:assert/strict";
import { test } from "vitest";
import { createAxiomBootstrapClient } from "../../../src/tools/axiom/client.mjs";

// Point the bootstrap reader at a guaranteed-nonexistent path so tests don't
// pick up whatever's saved on the developer's machine at
// ~/.config/agentic-devtools/axiom-bootstrap.json.
const ISOLATED_BOOTSTRAP_PATH = "/tmp/__axiom_bootstrap_test_does_not_exist.json";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
});

test("bootstrap client validates by listing tokens", async () => {
  const calls = [];
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "xaat-bootstrap", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method });
      return jsonResponse([{ id: "t1" }, { id: "t2" }]);
    },
  });
  const result = await client.validate();
  assert.equal(result.ok, true);
  assert.equal(result.tokenCount, 2);
  assert.match(calls[0].url, /\/v2\/tokens$/);
  assert.equal(calls[0].method, "GET");
});

test("bootstrap client mints a working token with dataset capabilities", async () => {
  const calls = [];
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "xaat-bootstrap", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      return jsonResponse({
        id: "tok-id",
        token: "xaat-newly-minted",
        name: "zero-frame-test",
        datasetCapabilities: { "my-app-prod": { query: ["read"] } },
        orgCapabilities: {},
      });
    },
  });

  const result = await client.mintWorkingToken({
    name: "zero-frame-test",
    datasets: ["my-app-prod"],
  });

  assert.equal(result.tokenValue, "xaat-newly-minted");
  assert.equal(result.tokenId, "tok-id");
  assert.equal(result.name, "zero-frame-test");

  // Verify POST shape
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/v2\/tokens$/);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.name, "zero-frame-test");
  assert.deepEqual(body.datasetCapabilities, {
    "my-app-prod": { query: ["read"] },
  });
  assert.deepEqual(body.orgCapabilities, {});
});

test("mintWorkingToken accepts datasets shortcut → defaults to query-only", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      // Confirm the dataset cap shape
      assert.deepEqual(body.datasetCapabilities, {
        ds1: { query: ["read"] },
        ds2: { query: ["read"] },
      });
      return jsonResponse({ id: "x", token: "xaat-x", name: body.name });
    },
  });
  await client.mintWorkingToken({ name: "t", datasets: ["ds1", "ds2"] });
});

test("mintWorkingToken with explicit datasetCapabilities overrides shortcut", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      assert.deepEqual(body.datasetCapabilities, {
        custom: { query: ["read"], ingest: ["create"] },
      });
      return jsonResponse({ id: "x", token: "xaat-x", name: body.name });
    },
  });
  await client.mintWorkingToken({
    name: "t",
    datasetCapabilities: {
      custom: { query: ["read"], ingest: ["create"] },
    },
  });
});

test("mintWorkingToken throws when name missing", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    () => client.mintWorkingToken({ datasets: ["ds"] }),
    /requires \{ name \}/,
  );
});

test("mintWorkingToken throws when neither datasets nor datasetCapabilities given", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async () => jsonResponse({}),
  });
  await assert.rejects(
    () => client.mintWorkingToken({ name: "x" }),
    /requires either \{ datasetCapabilities \} or \{ datasets/,
  );
});

test("mintWorkingToken throws when token missing on response", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async () => jsonResponse({ id: "tok-id" /* no token */ }),
  });
  await assert.rejects(
    () => client.mintWorkingToken({ name: "x", datasets: ["ds"] }),
    /did not return a token value/,
  );
});

test("bootstrap client throws cleanly when token missing (no HTTP attempted)", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    },
  });
  await assert.rejects(
    () => client.validate(),
    /Missing Axiom bootstrap token/,
  );
});

test("listAccessibleDatasets returns datasets when bootstrap has Query scope", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async (url) => {
      if (String(url).includes("/v1/datasets")) {
        return jsonResponse([{ name: "ds1" }, { name: "ds2" }]);
      }
      return jsonResponse({});
    },
  });
  const result = await client.listAccessibleDatasets();
  assert.equal(result.accessible, true);
  assert.equal(result.datasets.length, 2);
  assert.equal(result.narrowBootstrap, undefined);
});

test("listAccessibleDatasets reports narrow bootstrap when 403", async () => {
  const client = createAxiomBootstrapClient({
    env: { AXIOM_BOOTSTRAP_TOKEN: "t", AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH },
    fetchImpl: async () => jsonResponse({ message: "forbidden" }, 403),
  });
  const result = await client.listAccessibleDatasets();
  assert.equal(result.accessible, false);
  assert.equal(result.narrowBootstrap, true);
  assert.equal(result.datasets.length, 0);
});

test("bootstrap client sends x-axiom-org-id header when orgId set", async () => {
  let capturedHeaders;
  const client = createAxiomBootstrapClient({
    env: {
      AXIOM_BOOTSTRAP_TOKEN: "t",
      AXIOM_ORG_ID: "my-org",
      AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH,
    },
    fetchImpl: async (url, init) => {
      capturedHeaders = init.headers;
      return jsonResponse([]);
    },
  });
  await client.validate();
  assert.equal(capturedHeaders["x-axiom-org-id"], "my-org");
});

// Regression: a stored bootstrap config writes apiBaseUrl: "" when the user
// accepts the default during the bootstrap flow. The reader uses `??` which
// only catches null/undefined — empty string would slip through and produce
// `new URL("v1/datasets", "/")` → "Invalid URL".
test("bootstrap client falls back to default API base when stored apiBaseUrl is empty string", async () => {
  let capturedUrl;
  const client = createAxiomBootstrapClient({
    env: {
      AXIOM_BOOTSTRAP_TOKEN: "t",
      // Simulate the empty string that pickString lets through as a fallback
      AXIOM_API_BASE_URL: "",
      AXIOM_BOOTSTRAP_CONFIG_PATH: ISOLATED_BOOTSTRAP_PATH,
    },
    fetchImpl: async (url) => {
      capturedUrl = String(url);
      return jsonResponse([]);
    },
  });
  await client.listAccessibleDatasets();
  assert.match(capturedUrl, /^https:\/\/api\.axiom\.co\/v1\/datasets$/);
});
