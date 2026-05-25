import assert from "node:assert/strict";
import { test } from "vitest";
import { AxiomApiError } from "../../../src/tools/axiom/client.mjs";
import { mapAxiomError } from "../../../src/tools/axiom/error-mapper.mjs";

test("returns null for non-Axiom errors", () => {
  assert.equal(mapAxiomError(new Error("oops")), null);
  assert.equal(mapAxiomError(null), null);
});

test("401 → AUTH_EXPIRED with reconnect remediation + token URL", () => {
  const err = new AxiomApiError("Unauthorized", { status: 401, payload: {} });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
  assert.match(mapped.remediation.url, /app\.axiom\.co/);
});

test("403 → PERMISSION_DENIED mentioning required permission", () => {
  const err = new AxiomApiError("Forbidden", { status: 403, payload: {} });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.match(mapped.remediation.instructions, /permission/i);
});

test("404 → NOT_FOUND with code_change pointing at list_datasets", () => {
  const err = new AxiomApiError("not found", { status: 404, payload: {} });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "NOT_FOUND");
  assert.equal(mapped.remediation.kind, "code_change");
  assert.match(mapped.remediation.instructions, /list_datasets/i);
});

test("429 → RATE_LIMITED with wait remediation", () => {
  const err = new AxiomApiError("slow down", { status: 429, payload: {} });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "RATE_LIMITED");
  assert.equal(mapped.remediation.kind, "wait");
});

test("503 → TRANSIENT with retry remediation", () => {
  const err = new AxiomApiError("service unavailable", {
    status: 503,
    payload: {},
  });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "TRANSIENT");
  assert.equal(mapped.remediation.kind, "retry");
});

test("400 → VALIDATION_ERROR with APL hint", () => {
  const err = new AxiomApiError("invalid query", {
    status: 400,
    payload: { error: "expected `_time` field" },
  });
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "VALIDATION_ERROR");
  assert.match(mapped.remediation.instructions, /APL|case-sensitive/i);
});

test("pre-flight 'Missing Axiom API token' → AUTH_EXPIRED", () => {
  const err = new AxiomApiError(
    "Missing Axiom API token. Run `agentic-devtools connect axiom`.",
  );
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("pre-flight 'requires { apl }' → VALIDATION_ERROR", () => {
  const err = new AxiomApiError("axiom.query requires { apl: '...' }.");
  const mapped = mapAxiomError(err);
  assert.equal(mapped.code, "VALIDATION_ERROR");
  assert.equal(mapped.remediation.kind, "code_change");
});
