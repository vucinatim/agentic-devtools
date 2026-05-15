import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const importFresh = async (modulePath) =>
  import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);

const cloudflareAuthModulePath = path.join(
  process.cwd(),
  "src/tools/cloudflare/auth.mjs",
);

test("Cloudflare auth config can be saved and resolved from a local file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cloudflare-auth-"));
  const authPath = path.join(tempDir, "cloudflare.json");

  process.env.CLOUDFLARE_AUTH_CONFIG_PATH = authPath;
  delete process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_ZONE_ID;

  const authModule = await importFresh(cloudflareAuthModulePath);

  await authModule.saveCloudflareAuthConfig({
    token: "cf-token",
    defaultAccountId: "account-id",
    defaultZoneId: "zone-id",
  });

  const raw = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(raw.token, "cf-token");

  assert.deepEqual(authModule.resolveCloudflareAuthConfig(process.env), {
    token: "cf-token",
    defaultAccountId: "account-id",
    defaultZoneId: "zone-id",
    apiBaseUrl: "https://api.cloudflare.com/client/v4",
    source: "file",
  });

  const status = authModule.getCloudflareAuthStatus(process.env);
  assert.equal(status.configured, true);
  assert.equal(status.source, "file");
  assert.equal(status.defaultAccountId, "account-id");
  assert.equal(status.defaultZoneId, "zone-id");
  assert.equal("token" in status, false);
});

test("Cloudflare environment vars override stored auth config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "cloudflare-auth-"));
  const authPath = path.join(tempDir, "cloudflare.json");

  process.env.CLOUDFLARE_AUTH_CONFIG_PATH = authPath;
  delete process.env.CLOUDFLARE_API_TOKEN;

  const authModule = await importFresh(cloudflareAuthModulePath);
  await authModule.saveCloudflareAuthConfig({
    token: "file-token",
    defaultAccountId: "file-account",
  });

  assert.deepEqual(
    authModule.resolveCloudflareAuthConfig({
      CLOUDFLARE_AUTH_CONFIG_PATH: authPath,
      CLOUDFLARE_API_TOKEN: "env-token",
      CLOUDFLARE_ACCOUNT_ID: "env-account",
      CLOUDFLARE_ZONE_ID: "env-zone",
    }),
    {
      token: "env-token",
      defaultAccountId: "env-account",
      defaultZoneId: "env-zone",
      apiBaseUrl: "https://api.cloudflare.com/client/v4",
      source: "env:CLOUDFLARE_API_TOKEN",
    },
  );
});

