import assert from "node:assert/strict";
import { test } from "vitest";
import { CloudflareApiError } from "../../../src/tools/cloudflare/client.mjs";
import { mapCloudflareError } from "../../../src/tools/cloudflare/error-mapper.mjs";

test("returns null for non-Cloudflare errors", () => {
  assert.equal(mapCloudflareError(new Error("oops")), null);
  assert.equal(mapCloudflareError(null), null);
});

test("maps HTTP 401 to AUTH_EXPIRED with reconnect remediation", () => {
  const err = new CloudflareApiError("Auth failed", { status: 401, errors: [] });
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("maps HTTP 403 to PERMISSION_DENIED with dashboard url", () => {
  const err = new CloudflareApiError("forbidden", {
    status: 403,
    errors: [{ message: "Missing required permission" }],
  });
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.match(mapped.remediation.url, /dash.cloudflare.com/);
  assert.match(mapped.remediation.instructions, /missing permission/i);
});

test("maps HTTP 429 to RATE_LIMITED with wait remediation", () => {
  const err = new CloudflareApiError("slow down", { status: 429, errors: [] });
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "RATE_LIMITED");
  assert.equal(mapped.remediation.kind, "wait");
});

test("maps HTTP 500 to TRANSIENT with retry remediation", () => {
  const err = new CloudflareApiError("oh no", { status: 500, errors: [] });
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "TRANSIENT");
  assert.equal(mapped.remediation.kind, "retry");
});

test("maps pre-flight 'missing token' to AUTH_EXPIRED with reconnect", () => {
  const err = new CloudflareApiError(
    "Missing Cloudflare API token. Run `agentic-devtools connect cloudflare`.",
  );
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
  assert.match(mapped.remediation.instructions, /connect cloudflare/);
});

test("maps pre-flight validation errors (no status) to VALIDATION_ERROR", () => {
  const err = new CloudflareApiError(
    "createR2Bucket requires bucketName.",
  );
  const mapped = mapCloudflareError(err);
  assert.equal(mapped.code, "VALIDATION_ERROR");
  assert.equal(mapped.remediation.kind, "code_change");
});
