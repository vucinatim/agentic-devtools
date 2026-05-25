import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { beforeEach, test } from "vitest";
import { __clearPermissionGroupCache } from "../../../src/core/permission-group-resolver.mjs";
import { createCloudflareClient } from "../../../src/tools/cloudflare/client.mjs";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

// Mock permission groups catalog — matches what live Cloudflare returns for
// the names createR2ApiToken looks up.
const PERMISSION_GROUPS_CATALOG = [
  {
    id: "id-r2-bucket-write",
    name: "Workers R2 Storage Bucket Item Write",
    scopes: ["com.cloudflare.edge.r2.bucket"],
  },
  {
    id: "id-r2-bucket-read",
    name: "Workers R2 Storage Bucket Item Read",
    scopes: ["com.cloudflare.edge.r2.bucket"],
  },
  {
    id: "id-r2-account-write",
    name: "Workers R2 Storage Write",
    scopes: ["com.cloudflare.api.account"],
  },
];

// Helper: route /user/tokens/permission_groups → catalog;
// route POST /user/tokens → handler.
const mockFetch = ({ tokenResult, onTokenPost }) => {
  return async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/user/tokens/permission_groups")) {
      return jsonResponse({
        success: true,
        result: PERMISSION_GROUPS_CATALOG,
      });
    }
    if (u.endsWith("/user/tokens") && init.method === "POST") {
      onTokenPost?.({ url: u, init, body: init.body });
      return jsonResponse({ success: true, result: tokenResult });
    }
    throw new Error(`Unexpected fetch in test: ${init.method ?? "GET"} ${u}`);
  };
};

beforeEach(() => {
  __clearPermissionGroupCache();
});

test("createR2ApiToken mints S3-compatible credentials", async () => {
  const tokenPostCalls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "bootstrap-token",
      CLOUDFLARE_ACCOUNT_ID: "acct-123",
    },
    fetchImpl: mockFetch({
      tokenResult: {
        id: "token-id-abc",
        value: "super-secret-token-value",
        name: "r2-my-bucket-xyz",
        status: "active",
      },
      onTokenPost: (call) => tokenPostCalls.push(call),
    }),
  });

  const result = await client.createR2ApiToken({
    bucketName: "my-bucket",
    accountId: "acct-123",
    permission: "object-read-write",
    tokenName: "test-token",
  });

  // Verify the API call shape — the POST to /user/tokens
  assert.equal(tokenPostCalls.length, 1);
  assert.equal(tokenPostCalls[0].init.method, "POST");
  assert.equal(
    tokenPostCalls[0].url,
    "https://api.cloudflare.com/client/v4/user/tokens",
  );
  const body = JSON.parse(tokenPostCalls[0].body);
  assert.equal(body.name, "test-token");
  assert.equal(body.policies[0].effect, "allow");
  // The resolver looked up the live ID, not a hardcoded one.
  assert.equal(body.policies[0].permission_groups[0].id, "id-r2-bucket-write");
  assert.ok(
    body.policies[0].resources[
      "com.cloudflare.edge.r2.bucket.acct-123_default_my-bucket"
    ],
  );

  // Verify the returned credentials shape
  assert.equal(result.accessKeyId, "token-id-abc");
  assert.equal(
    result.secretAccessKey,
    createHash("sha256").update("super-secret-token-value").digest("hex"),
  );
  assert.equal(result.endpoint, "https://acct-123.r2.cloudflarestorage.com");
  assert.equal(result.bucketName, "my-bucket");
  assert.equal(result.permission, "object-read-write");
});

test("createR2ApiToken auto-generates a token name when not supplied", async () => {
  const tokenPostCalls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    },
    fetchImpl: mockFetch({
      tokenResult: { id: "tid", value: "tval" },
      onTokenPost: (call) => tokenPostCalls.push(call),
    }),
  });

  await client.createR2ApiToken({ bucketName: "auto-named" });
  assert.equal(tokenPostCalls.length, 1);
  const body = JSON.parse(tokenPostCalls[0].init.body);
  assert.match(body.name, /^r2-auto-named-\d+$/);
});

test("createR2ApiToken throws when Cloudflare returns no id/value", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    },
    fetchImpl: mockFetch({
      tokenResult: { id: "tid" /* no value */ },
    }),
  });

  await assert.rejects(
    () => client.createR2ApiToken({ bucketName: "b" }),
    /token without id\/value/,
  );
});

test("createR2ApiToken with object-read-only permission resolves correct group", async () => {
  const tokenPostCalls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    },
    fetchImpl: mockFetch({
      tokenResult: { id: "tid", value: "tval" },
      onTokenPost: (call) => tokenPostCalls.push(call),
    }),
  });

  await client.createR2ApiToken({
    bucketName: "ro-bucket",
    permission: "object-read-only",
  });

  const body = JSON.parse(tokenPostCalls[0].init.body);
  assert.equal(body.policies[0].permission_groups[0].id, "id-r2-bucket-read");
});
