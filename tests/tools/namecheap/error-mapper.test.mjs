import assert from "node:assert/strict";
import { test } from "vitest";
import { NamecheapApiError } from "../../../src/tools/namecheap/client.mjs";
import { mapNamecheapError } from "../../../src/tools/namecheap/error-mapper.mjs";

test("returns null for non-Namecheap errors", () => {
  assert.equal(mapNamecheapError(new Error("oops")), null);
  assert.equal(mapNamecheapError(null), null);
});

test("maps IP-allowlist error to PERMISSION_DENIED with dashboard remediation", () => {
  const err = new NamecheapApiError("IP not allowed", {
    command: "namecheap.domains.dns.getHosts",
    errors: [{ Number: 1019103, message: "IP is not in the whitelist" }],
  });
  const mapped = mapNamecheapError(err);
  assert.equal(mapped.code, "PERMISSION_DENIED");
  assert.equal(mapped.remediation.kind, "dashboard");
  assert.match(mapped.remediation.url, /namecheap.com/);
  assert.match(mapped.remediation.instructions, /allowlist/i);
});

test("maps API key error to AUTH_EXPIRED with reconnect remediation", () => {
  const err = new NamecheapApiError("API Key is invalid", {
    errors: [{ Number: 1010101, message: "API Key is invalid" }],
  });
  const mapped = mapNamecheapError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("pre-flight missing-config error becomes AUTH_EXPIRED", () => {
  const err = new NamecheapApiError("Missing NAMECHEAP_API_KEY.");
  const mapped = mapNamecheapError(err);
  assert.equal(mapped.code, "AUTH_EXPIRED");
  assert.equal(mapped.remediation.kind, "reconnect");
});

test("pre-flight tool-argument error becomes VALIDATION_ERROR", () => {
  const err = new NamecheapApiError("Domain name is required.");
  const mapped = mapNamecheapError(err);
  assert.equal(mapped.code, "VALIDATION_ERROR");
  assert.equal(mapped.remediation.kind, "code_change");
});
