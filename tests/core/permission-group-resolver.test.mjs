import assert from "node:assert/strict";
import { beforeEach, test } from "vitest";
import {
  CLOUDFLARE_PERMISSION_GROUP_FALLBACKS,
  __clearPermissionGroupCache,
  getCloudflarePermissionGroups,
  resolveCloudflarePermissionGroup,
  resolveCloudflarePermissionGroups,
} from "../../src/core/permission-group-resolver.mjs";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

const mockCatalog = [
  {
    id: "id-r2-bucket-write",
    name: "Workers R2 Storage Bucket Item Write",
    scopes: ["com.cloudflare.edge.r2.bucket"],
  },
  {
    id: "id-r2-account-write",
    name: "Workers R2 Storage Write",
    scopes: ["com.cloudflare.api.account"],
  },
  {
    id: "id-api-tokens-write-user",
    name: "API Tokens Write",
    scopes: ["com.cloudflare.api.user"],
  },
  {
    id: "id-api-tokens-write-account",
    name: "Account API Tokens Write",
    scopes: ["com.cloudflare.api.account"],
  },
  {
    id: "id-dns-write",
    name: "DNS Write",
    scopes: ["com.cloudflare.api.account.zone"],
  },
];

beforeEach(() => {
  __clearPermissionGroupCache();
});

test("getCloudflarePermissionGroups fetches from API and caches", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return jsonResponse({ success: true, result: mockCatalog });
  };
  const opts = { authToken: "t", fetchImpl };

  const first = await getCloudflarePermissionGroups(opts);
  const second = await getCloudflarePermissionGroups(opts);

  assert.equal(callCount, 1, "second call hit cache");
  assert.equal(first.length, mockCatalog.length);
  assert.equal(second, first);
});

test("getCloudflarePermissionGroups dedupes concurrent fetches", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    await new Promise((r) => setTimeout(r, 10));
    return jsonResponse({ success: true, result: mockCatalog });
  };
  const opts = { authToken: "t", fetchImpl };

  const [a, b, c] = await Promise.all([
    getCloudflarePermissionGroups(opts),
    getCloudflarePermissionGroups(opts),
    getCloudflarePermissionGroups(opts),
  ]);
  assert.equal(callCount, 1, "concurrent calls coalesced");
  assert.equal(a, b);
  assert.equal(b, c);
});

test("getCloudflarePermissionGroups refetches after TTL", async () => {
  let callCount = 0;
  const fetchImpl = async () => {
    callCount += 1;
    return jsonResponse({ success: true, result: mockCatalog });
  };
  // Simulate clock advancing past 24h between calls.
  let t = 0;
  const now = () => t;

  await getCloudflarePermissionGroups({ authToken: "t", fetchImpl, now });
  t += 25 * 60 * 60 * 1000; // 25h
  await getCloudflarePermissionGroups({ authToken: "t", fetchImpl, now });

  assert.equal(callCount, 2);
});

test("getCloudflarePermissionGroups returns fallback when no token + no cache", async () => {
  const groups = await getCloudflarePermissionGroups({}); // no authToken
  // Falls back to bundled table.
  const names = groups.map((g) => g.name);
  assert.ok(names.includes("API Tokens Write"));
  assert.ok(names.includes("Workers R2 Storage Bucket Item Write"));
});

test("resolveCloudflarePermissionGroup looks up by exact name", async () => {
  const fetchImpl = async () =>
    jsonResponse({ success: true, result: mockCatalog });

  const result = await resolveCloudflarePermissionGroup({
    name: "DNS Write",
    authToken: "t",
    fetchImpl,
  });
  assert.equal(result.id, "id-dns-write");
});

test("resolveCloudflarePermissionGroup disambiguates by scope when multiple match", async () => {
  const fetchImpl = async () =>
    jsonResponse({ success: true, result: mockCatalog });

  // Without scope, 'API Tokens Write' matches just one (the exact name).
  const userScoped = await resolveCloudflarePermissionGroup({
    name: "API Tokens Write",
    scope: "com.cloudflare.api.user",
    authToken: "t",
    fetchImpl,
  });
  assert.equal(userScoped.id, "id-api-tokens-write-user");
});

test("resolveCloudflarePermissionGroup uses fallback table when API fails", async () => {
  const fetchImpl = async () => {
    throw new Error("network down");
  };
  // R2 bucket write is in the fallback table.
  const result = await resolveCloudflarePermissionGroup({
    name: "Workers R2 Storage Bucket Item Write",
    authToken: "t",
    fetchImpl,
  });
  assert.equal(
    result.id,
    CLOUDFLARE_PERMISSION_GROUP_FALLBACKS["Workers R2 Storage Bucket Item Write"]
      .id,
  );
});

test("resolveCloudflarePermissionGroup throws for unknown name with no fallback", async () => {
  const fetchImpl = async () =>
    jsonResponse({ success: true, result: mockCatalog });
  await assert.rejects(
    () =>
      resolveCloudflarePermissionGroup({
        name: "Nonexistent Permission",
        authToken: "t",
        fetchImpl,
      }),
    /not found/,
  );
});

test("resolveCloudflarePermissionGroups batches multiple specs", async () => {
  const fetchImpl = async () =>
    jsonResponse({ success: true, result: mockCatalog });

  const results = await resolveCloudflarePermissionGroups(
    [
      { name: "DNS Write" },
      { name: "API Tokens Write", scope: "com.cloudflare.api.user" },
    ],
    { authToken: "t", fetchImpl },
  );

  assert.equal(results.length, 2);
  assert.equal(results[0].id, "id-dns-write");
  assert.equal(results[1].id, "id-api-tokens-write-user");
});

test("CLOUDFLARE_PERMISSION_GROUP_FALLBACKS table is exhaustive for Zero Frame's needs", () => {
  // These are the names our hardcoded specs reference. Each must resolve in
  // the fallback even if the live API is down.
  const required = [
    "Workers R2 Storage Bucket Item Write",
    "Workers R2 Storage Bucket Item Read",
    "Workers R2 Storage Write",
    "Workers Scripts Write",
    "DNS Write",
    "Zone Read",
    "API Tokens Write",
  ];
  for (const name of required) {
    assert.ok(
      CLOUDFLARE_PERMISSION_GROUP_FALLBACKS[name],
      `fallback missing for ${name}`,
    );
    assert.ok(
      CLOUDFLARE_PERMISSION_GROUP_FALLBACKS[name].id,
      `fallback id missing for ${name}`,
    );
  }
});
