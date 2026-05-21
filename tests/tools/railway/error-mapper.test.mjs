import assert from "node:assert/strict";
import { test } from "vitest";
import { RailwayApiError } from "../../../src/tools/railway/client.mjs";
import { mapRailwayError } from "../../../src/tools/railway/error-mapper.mjs";

test("returns null for non-Railway errors", () => {
  assert.equal(mapRailwayError(new Error("oops")), null);
  assert.equal(mapRailwayError(null), null);
});

test("maps HTTP 401 to AUTH_EXPIRED with reconnect remediation", () => {
  const err = new RailwayApiError("unauthorized", { status: 401, errors: [] });
  const mapped = mapRailwayError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("maps HTTP 403 to PERMISSION_DENIED with dashboard URL", () => {
  const err = new RailwayApiError("forbidden", { status: 403, errors: [] });
  const mapped = mapRailwayError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.match(mapped.remediation.url, /railway.com/);
});

test("maps 5xx to TRANSIENT with retry remediation", () => {
  const err = new RailwayApiError("oh no", { status: 502, errors: [] });
  const mapped = mapRailwayError(err);
  assert.equal(mapped.code, "TRANSIENT");
  assert.equal(mapped.remediation.kind, "retry");
});

test("pre-flight 'Missing Railway API token' becomes AUTH_EXPIRED", () => {
  const err = new RailwayApiError(
    "Missing Railway API token. Run `agentic-devtools connect railway`.",
  );
  const mapped = mapRailwayError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("pre-flight 'requires an account token' becomes PERMISSION_DENIED", () => {
  const err = new RailwayApiError(
    "validateRailwayAccountToken requires an account token. Use RAILWAY_API_TOKEN.",
  );
  const mapped = mapRailwayError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.equal(mapped.remediation.kind, "reconnect");
});
