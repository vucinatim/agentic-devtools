import assert from "node:assert/strict";
import { test } from "vitest";
import { NpmRegistryError } from "../../../src/tools/npm/client.mjs";
import { mapNpmError } from "../../../src/tools/npm/error-mapper.mjs";

test("returns null for non-npm errors", () => {
  assert.equal(mapNpmError(new Error("oops")), null);
  assert.equal(mapNpmError(null), null);
});

test("maps 401 to AUTH_EXPIRED with reconnect remediation", () => {
  const err = new NpmRegistryError("Unauthorized", { status: 401, payload: {} });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("maps 401 with OTP requirement to PERMISSION_DENIED + Automation token hint", () => {
  const err = new NpmRegistryError("OTP required", {
    status: 401,
    payload: { error: "must provide otp" },
  });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.match(mapped.remediation.instructions, /Automation token/i);
});

test("maps 403 to PERMISSION_DENIED with scope-fix instructions", () => {
  const err = new NpmRegistryError("Forbidden", { status: 403, payload: {} });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.match(mapped.remediation.instructions, /scope/i);
});

test("maps 404 to NOT_FOUND with code_change remediation", () => {
  const err = new NpmRegistryError("not found", { status: 404, payload: {} });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "NOT_FOUND");
  assert.equal(mapped.remediation.kind, "code_change");
});

test("maps 429 to RATE_LIMITED with wait remediation", () => {
  const err = new NpmRegistryError("slow down", { status: 429, payload: {} });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "RATE_LIMITED");
  assert.equal(mapped.remediation.kind, "wait");
});

test("maps 500 to TRANSIENT with retry remediation", () => {
  const err = new NpmRegistryError("internal", { status: 503, payload: {} });
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "TRANSIENT");
  assert.equal(mapped.remediation.kind, "retry");
});

test("pre-flight 'Missing npm token' becomes AUTH_EXPIRED", () => {
  const err = new NpmRegistryError(
    "Missing npm token. Run `agentic-devtools connect npm`.",
  );
  const mapped = mapNpmError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});
