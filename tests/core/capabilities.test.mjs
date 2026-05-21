import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CAPABILITIES,
  capabilitiesFor,
  probeScopes,
} from "../../src/core/capabilities.mjs";

test("CAPABILITIES exposes the known providers", () => {
  for (const provider of ["cloudflare", "railway", "namecheap", "npm"]) {
    assert.ok(CAPABILITIES[provider], `expected ${provider} entry`);
    assert.ok(Array.isArray(CAPABILITIES[provider].scopes));
    assert.ok(CAPABILITIES[provider].dashboard_token_url);
  }
});

test("capabilitiesFor unknown provider returns undefined", () => {
  assert.equal(capabilitiesFor("does-not-exist"), undefined);
});

test("probeScopes finds exact matches", () => {
  const { granted, missing } = probeScopes("cloudflare", [
    "com.cloudflare.api.account.r2.bucket.edit",
    "com.cloudflare.api.user.api_tokens.write",
  ]);

  const grantedIds = granted.map((s) => s.id);
  assert.ok(grantedIds.includes("com.cloudflare.api.account.r2.bucket.edit"));
  assert.ok(grantedIds.includes("com.cloudflare.api.user.api_tokens.write"));
  assert.ok(missing.length >= 1, "should still have missing scopes");
});

test("probeScopes returns all scopes missing when none granted", () => {
  const { granted, missing } = probeScopes("cloudflare", []);
  assert.equal(granted.length, 0);
  assert.equal(missing.length, CAPABILITIES.cloudflare.scopes.length);
});

test("probeScopes is case-insensitive on display labels", () => {
  // Display labels are mixed case; pass them in lower form.
  const { granted } = probeScopes("cloudflare", [
    "account · r2 storage (edit)",
  ]);
  assert.ok(granted.length >= 1);
});

test("probeScopes flags unknown_provider for unknown provider", () => {
  const result = probeScopes("does-not-exist", ["whatever"]);
  assert.equal(result.unknown_provider, true);
});
