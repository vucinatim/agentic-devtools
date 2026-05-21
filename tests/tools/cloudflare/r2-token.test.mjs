import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "vitest";
import { createCloudflareClient } from "../../../src/tools/cloudflare/client.mjs";

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test("createR2ApiToken mints S3-compatible credentials", async () => {
  const calls = [];
  const tokenId = "token-id-abc";
  const tokenValue = "super-secret-token-value";

  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "bootstrap-token",
      CLOUDFLARE_ACCOUNT_ID: "acct-123",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), method: init.method, body: init.body });
      return jsonResponse({
        success: true,
        result: {
          id: tokenId,
          value: tokenValue,
          name: "r2-my-bucket-xyz",
          status: "active",
        },
      });
    },
  });

  const result = await client.createR2ApiToken({
    bucketName: "my-bucket",
    accountId: "acct-123",
    permission: "object-read-write",
    tokenName: "test-token",
  });

  // Verify the API call shape
  assert.equal(calls[0].method, "POST");
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/user/tokens",
  );
  const body = JSON.parse(calls[0].body);
  assert.equal(body.name, "test-token");
  assert.equal(body.policies[0].effect, "allow");
  assert.ok(body.policies[0].permission_groups[0].id);
  assert.ok(
    body.policies[0].resources[
      "com.cloudflare.edge.r2.bucket.acct-123_default_my-bucket"
    ],
  );

  // Verify the returned credentials shape
  assert.equal(result.accessKeyId, tokenId);
  assert.equal(
    result.secretAccessKey,
    createHash("sha256").update(tokenValue).digest("hex"),
  );
  assert.equal(
    result.endpoint,
    "https://acct-123.r2.cloudflarestorage.com",
  );
  assert.equal(result.bucketName, "my-bucket");
  assert.equal(result.permission, "object-read-write");
});

test("createR2ApiToken auto-generates a token name when not supplied", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    },
    fetchImpl: async (url, init) => {
      calls.push({ body: init.body });
      return jsonResponse({
        success: true,
        result: { id: "tid", value: "tval" },
      });
    },
  });

  await client.createR2ApiToken({ bucketName: "auto-named" });
  const body = JSON.parse(calls[0].body);
  assert.match(body.name, /^r2-auto-named-\d+$/);
});

test("createR2ApiToken throws when Cloudflare returns no id/value", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "acct",
    },
    fetchImpl: async () =>
      jsonResponse({ success: true, result: { id: "tid" /* no value */ } }),
  });

  await assert.rejects(
    () => client.createR2ApiToken({ bucketName: "b" }),
    /token without id\/value/,
  );
});
