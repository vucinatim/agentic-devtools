import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CloudflareApiError,
  createCloudflareClient,
  getCloudflareAuthStatus,
  resolveCloudflareAuthConfig,
} from "../../../src/tools/cloudflare/client.mjs";

test("reports Cloudflare auth status without exposing token values", () => {
  const status = getCloudflareAuthStatus({
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "account-id",
    CLOUDFLARE_ZONE_ID: "zone-id",
  });

  assert.equal(status.configured, true);
  assert.equal(status.source, "env:CLOUDFLARE_API_TOKEN");
  assert.equal(status.defaultAccountId, "account-id");
  assert.equal(status.defaultZoneId, "zone-id");
  assert.equal("token" in status, false);
});

test("resolves Cloudflare token from env", () => {
  assert.deepEqual(
    resolveCloudflareAuthConfig({
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
    }),
    {
      token: "token",
      defaultAccountId: "account-id",
      defaultZoneId: null,
      apiBaseUrl: "https://api.cloudflare.com/client/v4",
      source: "env:CLOUDFLARE_API_TOKEN",
    },
  );
});

test("uses bearer auth for token verification and zone listing", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({
        success: true,
        result: { id: "token-id", status: "active" },
      });
    },
  });

  const result = await client.validateToken();

  assert.equal(result.status, "active");
  assert.equal(
    calls[0].url,
    "https://api.cloudflare.com/client/v4/user/tokens/verify",
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer token");
});

test("lists accounts from the API when available", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/accounts")) {
        return jsonResponse({
          success: true,
          result: [{ id: "account-id", name: "Tim Account" }],
          result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
        });
      }

      return jsonResponse({
        success: true,
        result: { id: "token-id", status: "active" },
      });
    },
  });

  const result = await client.listAccounts();

  assert.equal(result.source, "api");
  assert.deepEqual(result.accounts, [{ id: "account-id", name: "Tim Account" }]);
});

test("falls back to zone-derived account discovery when accounts endpoint is unavailable", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/accounts")) {
        return jsonResponse(
          {
            success: false,
            errors: [{ message: "Authentication error" }],
          },
          { status: 403 },
        );
      }

      if (String(url).includes("/zones")) {
        return jsonResponse({
          success: true,
          result: [
            {
              id: "zone-a",
              name: "alpha.com",
              account: { id: "account-a", name: "Alpha Account" },
            },
            {
              id: "zone-b",
              name: "beta.com",
              account: { id: "account-b", name: "Beta Account" },
            },
          ],
        });
      }

      return jsonResponse({ success: true, result: {} });
    },
  });

  const result = await client.listAccounts();

  assert.equal(result.source, "zones");
  assert.deepEqual(result.accounts, [
    { id: "account-a", name: "Alpha Account" },
    { id: "account-b", name: "Beta Account" },
  ]);
});

test("manages tunnels, tokens, configuration, and connection cleanup with explicit account resolution", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init: {
          ...init,
          body: init.body ? JSON.parse(init.body) : undefined,
        },
      });

      if (String(url).endsWith("/cfd_tunnel") && init.method === "GET") {
        return jsonResponse({
          success: true,
          result: [{ id: "tunnel-id", name: "magnify-origin", status: "inactive" }],
          result_info: { page: 1, per_page: 20, total_pages: 1, count: 1, total_count: 1 },
        });
      }

      if (String(url).endsWith("/token")) {
        return jsonResponse({ success: true, result: "tunnel-token" });
      }

      if (String(url).endsWith("/configurations") && init.method === "GET") {
        return jsonResponse({
          success: true,
          result: {
            account_id: "account-id",
            config: {
              ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }],
            },
          },
        });
      }

      if (String(url).endsWith("/configurations") && init.method === "PUT") {
        return jsonResponse({
          success: true,
          result: {
            account_id: "account-id",
            config: init.body.config,
          },
        });
      }

      if (String(url).endsWith("/connections")) {
        return jsonResponse({
          success: true,
          result:
            init.method === "DELETE"
              ? null
              : [{ id: "connector-id", conns: [{ id: "conn-id", colo_name: "FRA" }] }],
        });
      }

      return jsonResponse({
        success: true,
        result: {
          id: "tunnel-id",
          name: init.body?.name ?? "magnify-origin",
          config_src: "cloudflare",
        },
      });
    },
  });

  const listResult = await client.listTunnels({ name: "magnify" });
  const created = await client.createTunnel({
    name: "magnify-origin",
    configSource: "cloudflare",
  });
  const tunnel = await client.getTunnel({ tunnelId: "tunnel-id" });
  const updated = await client.updateTunnel({
    tunnelId: "tunnel-id",
    name: "magnify-origin-next",
  });
  const token = await client.getTunnelToken({ tunnelId: "tunnel-id" });
  const config = await client.getTunnelConfiguration({ tunnelId: "tunnel-id" });
  const updatedConfig = await client.updateTunnelConfiguration({
    tunnelId: "tunnel-id",
    config: {
      ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }],
    },
  });
  const connections = await client.listTunnelConnections({ tunnelId: "tunnel-id" });
  const cleanup = await client.cleanupTunnelConnections({
    tunnelId: "tunnel-id",
    clientId: "connector-id",
  });
  const deleted = await client.deleteTunnel({ tunnelId: "tunnel-id" });

  assert.equal(listResult.accountId, "account-id");
  assert.equal(created.id, "tunnel-id");
  assert.equal(tunnel.id, "tunnel-id");
  assert.equal(updated.id, "tunnel-id");
  assert.equal(token.token, "tunnel-token");
  assert.equal(config.account_id, "account-id");
  assert.ok(updatedConfig);
  assert.equal(connections.connections[0].id, "connector-id");
  assert.deepEqual(cleanup, {
    cleanedUp: true,
    accountId: "account-id",
    tunnelId: "tunnel-id",
    clientId: "connector-id",
  });
  assert.deepEqual(deleted, {
    deleted: true,
    accountId: "account-id",
    tunnelId: "tunnel-id",
  });
  assert.match(calls[0].url, /\/accounts\/account-id\/cfd_tunnel\?name=magnify&page=1&per_page=20$/);
  assert.equal(calls[1].init.body.config_src, "cloudflare");
  assert.equal(calls[3].init.body.name, "magnify-origin-next");
  assert.equal(calls[4].url, "https://api.cloudflare.com/client/v4/accounts/account-id/cfd_tunnel/tunnel-id/token");
  assert.deepEqual(calls[6].init.body, {
    config: {
      ingress: [{ hostname: "app.example.com", service: "http://localhost:3000" }],
    },
  });
  assert.match(calls[8].url, /\/connections\?client_id=connector-id$/);
});

test("resolves tunnel operations by account and tunnel name", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init,
      });

      if (String(url).includes("/accounts?")) {
        return jsonResponse(
          {
            success: false,
            errors: [{ message: "Authentication error" }],
          },
          { status: 403 },
        );
      }

      if (String(url).includes("/zones?")) {
        return jsonResponse({
          success: true,
          result: [
            {
              id: "zone-id",
              name: "magnify-all.com",
              account: {
                id: "marcel-account-id",
                name: "Marcel.tori21@gmail.com's Account",
              },
            },
          ],
        });
      }

      if (String(url).includes("/cfd_tunnel?")) {
        return jsonResponse({
          success: true,
          result: [{ id: "tunnel-id", name: "magnify-origin" }],
        });
      }

      return jsonResponse({
        success: true,
        result: { id: "tunnel-id", name: "magnify-origin" },
      });
    },
  });

  await client.getTunnel({
    accountName: "marcel",
    tunnelName: "magnify-origin",
  });

  assert.match(calls[0].url, /\/accounts\?name=marcel&page=1&per_page=50$/);
  assert.match(calls[1].url, /\/zones\?page=1&per_page=50$/);
  assert.match(calls[2].url, /\/accounts\/marcel-account-id\/cfd_tunnel\?name=magnify-origin&page=1&per_page=50$/);
  assert.equal(calls[3].url, "https://api.cloudflare.com/client/v4/accounts/marcel-account-id/cfd_tunnel/tunnel-id");
});

test("requires a tunnel secret for locally managed tunnel creation", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
    },
    fetchImpl: async () => jsonResponse({ success: true, result: {} }),
  });

  await assert.rejects(
    () =>
      client.createTunnel({
        name: "local-origin",
        configSource: "local",
      }),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("requires tunnelSecret"),
  );
});

test("lists and mutates DNS records with explicit zone resolution", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ZONE_ID: "zone-id",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init: {
          ...init,
          body: init.body ? JSON.parse(init.body) : undefined,
        },
      });

      return jsonResponse({
        success: true,
        result:
          init.method === "DELETE"
            ? { id: "record-id" }
            : {
                id: "record-id",
                type: "CNAME",
                name: "api.example.com",
                content: "origin.example.com",
              },
        result_info: { page: 1, per_page: 20, total_count: 1 },
      });
    },
  });

  await client.listDnsRecords({ name: "api.example.com", type: "CNAME" });
  await client.createDnsRecord({
    type: "CNAME",
    name: "api.example.com",
    content: "origin.example.com",
    proxied: false,
  });
  await client.updateDnsRecord({
    recordId: "record-id",
    content: "next-origin.example.com",
    proxied: true,
  });
  const deleted = await client.deleteDnsRecord({ recordId: "record-id" });

  assert.match(
    calls[0].url,
    /\/zones\/zone-id\/dns_records\?name=api\.example\.com&type=CNAME&page=1&per_page=20$/,
  );
  assert.deepEqual(calls[1].init.body, {
    type: "CNAME",
    name: "api.example.com",
    content: "origin.example.com",
    proxied: false,
  });
  assert.equal(calls[2].init.method, "PATCH");
  assert.deepEqual(calls[2].init.body, {
    content: "next-origin.example.com",
    proxied: true,
  });
  assert.deepEqual(deleted, {
    deleted: true,
    recordId: "record-id",
    zoneId: "zone-id",
  });
});

test("resolves DNS operations by zone name when ids are not provided", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init: {
          ...init,
          body: init.body ? JSON.parse(init.body) : undefined,
        },
      });

      if (String(url).includes("/zones?")) {
        return jsonResponse({
          success: true,
          result: [
            {
              id: "zone-id",
              name: "magnify-all.com",
              account: { id: "account-id", name: "Marcel Account" },
            },
          ],
        });
      }

      return jsonResponse({
        success: true,
        result: {
          id: "record-id",
          type: "TXT",
          name: "_smoke.magnify-all.com",
          content: "hello",
        },
      });
    },
  });

  await client.createDnsRecord({
    zoneName: "magnify-all.com",
    type: "TXT",
    name: "_smoke.magnify-all.com",
    content: "hello",
  });

  assert.match(calls[0].url, /\/zones\?name=magnify-all\.com&page=1&per_page=50$/);
  assert.equal(calls[1].url, "https://api.cloudflare.com/client/v4/zones/zone-id/dns_records");
});

test("manages R2 buckets and domains with account-scoped headers", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
      CLOUDFLARE_ACCOUNT_ID: "account-id",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init: {
          ...init,
          body: init.body ? JSON.parse(init.body) : undefined,
        },
      });

      return jsonResponse({
        success: true,
        result: (() => {
          if (String(url).includes("/domains/managed")) {
            return {
              bucketId: "bucket-id",
              domain: "bucket.r2.dev",
              enabled: true,
            };
          }
          if (String(url).includes("/domains/custom")) {
            return {
              domain: "cdn.example.com",
              enabled: true,
              status: { ownership: "active", ssl: "active" },
            };
          }
          if (String(url).includes("/r2/buckets") && init.method === "GET") {
            if (String(url).endsWith("/r2/buckets")) {
              return {
                buckets: [{ name: "media", storage_class: "Standard" }],
              };
            }
            return { name: "media", storage_class: "Standard" };
          }
          return { name: "media", storage_class: "Standard" };
        })(),
      });
    },
  });

  const buckets = await client.listR2Buckets({ jurisdiction: "eu" });
  await client.createR2Bucket({
    bucketName: "media",
    locationHint: "weur",
    storageClass: "Standard",
    jurisdiction: "eu",
  });
  await client.updateR2Bucket({
    bucketName: "media",
    storageClass: "InfrequentAccess",
    jurisdiction: "eu",
  });
  await client.getR2ManagedDomain({ bucketName: "media" });
  await client.updateR2ManagedDomain({ bucketName: "media", enabled: true });
  await client.createR2CustomDomain({
    bucketName: "media",
    domain: "cdn.example.com",
    zoneId: "zone-id",
  });
  const deleted = await client.deleteR2Bucket({
    bucketName: "media",
    jurisdiction: "eu",
  });

  assert.deepEqual(buckets, [{ name: "media", storage_class: "Standard" }]);
  assert.equal(calls[0].init.headers["cf-r2-jurisdiction"], "eu");
  assert.deepEqual(calls[1].init.body, {
    name: "media",
    locationHint: "weur",
    storageClass: "Standard",
  });
  assert.equal(
    calls[2].init.headers["cf-r2-storage-class"],
    "InfrequentAccess",
  );
  assert.match(calls[5].url, /\/domains\/custom$/);
  assert.deepEqual(calls[5].init.body, {
    domain: "cdn.example.com",
    zoneId: "zone-id",
  });
  assert.deepEqual(deleted, {
    deleted: true,
    bucketName: "media",
    accountId: "account-id",
    jurisdiction: "eu",
  });
});

test("resolves R2 operations by account name when ids are not provided", async () => {
  const calls = [];
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url, init) => {
      calls.push({
        url: String(url),
        init: {
          ...init,
          body: init.body ? JSON.parse(init.body) : undefined,
        },
      });

      if (String(url).includes("/accounts?")) {
        return jsonResponse(
          {
            success: false,
            errors: [{ message: "Authentication error" }],
          },
          { status: 403 },
        );
      }

      if (String(url).includes("/zones?")) {
        return jsonResponse({
          success: true,
          result: [
            {
              id: "zone-id",
              name: "magnify-all.com",
              account: {
                id: "marcel-account-id",
                name: "Marcel.tori21@gmail.com's Account",
              },
            },
          ],
        });
      }

      return jsonResponse({
        success: true,
        result: { name: "media", storage_class: "Standard" },
      });
    },
  });

  await client.createR2Bucket({
    accountName: "marcel",
    bucketName: "media",
    storageClass: "Standard",
  });

  assert.match(calls[0].url, /\/accounts\?name=marcel&page=1&per_page=50$/);
  assert.match(calls[1].url, /\/zones\?page=1&per_page=50$/);
  assert.equal(calls[2].url, "https://api.cloudflare.com/client/v4/accounts/marcel-account-id/r2/buckets");
});

test("requires auth and explicit account or zone ids where needed", async () => {
  const unauthenticated = createCloudflareClient({
    env: {},
    fetchImpl: async () => jsonResponse({}),
  });
  const authenticated = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async () => jsonResponse({ success: true, result: [] }),
  });

  await assert.rejects(
    () => unauthenticated.validateToken(),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("Missing Cloudflare API token"),
  );

  await assert.rejects(
    () => authenticated.listDnsRecords(),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("requires a Cloudflare zone"),
  );

  await assert.rejects(
    () => authenticated.listR2Buckets(),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("requires a Cloudflare account"),
  );

  await assert.rejects(
    () => authenticated.getDnsRecord({ zoneId: "zone-id" }),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("requires recordId"),
  );
});

test("raises a clear error when a name-based zone selection is ambiguous", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async (url) => {
      if (String(url).includes("/zones?")) {
        return jsonResponse({
          success: true,
          result: [
            { id: "zone-a", name: "api.example.com", account: { id: "a", name: "A" } },
            { id: "zone-b", name: "api.example.net", account: { id: "b", name: "B" } },
          ],
        });
      }

      return jsonResponse({ success: true, result: [] });
    },
  });

  await assert.rejects(
    () =>
      client.listDnsRecords({
        zoneName: "api.example",
      }),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message.includes("found multiple matching zones"),
  );
});

test("surfaces Cloudflare API errors", async () => {
  const client = createCloudflareClient({
    env: {
      CLOUDFLARE_API_TOKEN: "token",
    },
    fetchImpl: async () =>
      jsonResponse(
        {
          success: false,
          errors: [{ message: "Invalid request" }],
        },
        { ok: false, status: 400 },
      ),
  });

  await assert.rejects(
    () => client.validateToken(),
    (error) =>
      error instanceof CloudflareApiError &&
      error.message === "Invalid request",
  );
});

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});
