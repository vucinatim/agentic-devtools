import assert from "node:assert/strict";
import { test } from "vitest";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const importFresh = async (modulePath) =>
  import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);

const authModulePath = path.join(process.cwd(), "src/tools/namecheap/auth.mjs");

test("auth config can be saved and resolved from a local file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "namecheap-auth-"));
  const authPath = path.join(tempDir, ".namecheap-auth.json");

  process.env.NAMECHEAP_AUTH_CONFIG_PATH = authPath;
  delete process.env.NAMECHEAP_API_USER;
  delete process.env.NAMECHEAP_API_KEY;
  delete process.env.NAMECHEAP_USERNAME;
  delete process.env.NAMECHEAP_CLIENT_IP;
  delete process.env.NAMECHEAP_API_SANDBOX;
  delete process.env.NAMECHEAP_API_BASE_URL;

  const authModule = await importFresh(authModulePath);

  await authModule.saveAuthConfig({
    apiUser: "sandbox-user",
    apiKey: "sandbox-key",
    username: "sandbox-user",
    clientIp: "127.0.0.1",
    sandbox: true,
  });

  const raw = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(raw.apiUser, "sandbox-user");

  const status = await authModule.getAuthStatus();
  assert.equal(status.configured, true);
  assert.equal(status.source, "file");
  assert.equal(status.sandbox, true);
});

test("environment variables override the stored auth file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "namecheap-auth-"));
  const authPath = path.join(tempDir, ".namecheap-auth.json");

  process.env.NAMECHEAP_AUTH_CONFIG_PATH = authPath;
  process.env.NAMECHEAP_API_USER = "env-user";
  process.env.NAMECHEAP_API_KEY = "env-key";
  process.env.NAMECHEAP_USERNAME = "env-user";
  process.env.NAMECHEAP_CLIENT_IP = "203.0.113.5";
  process.env.NAMECHEAP_API_SANDBOX = "1";

  const authModule = await importFresh(authModulePath);

  await authModule.saveAuthConfig({
    apiUser: "file-user",
    apiKey: "file-key",
    username: "file-user",
    clientIp: "127.0.0.1",
    sandbox: false,
  });

  const resolved = await authModule.getResolvedAuthConfig();
  assert.equal(resolved.apiUser, "env-user");
  assert.equal(resolved.apiKey, "env-key");
  assert.equal(resolved.clientIp, "203.0.113.5");
  assert.equal(resolved.source, "env");
  assert.equal(resolved.sandbox, true);
});

test("public IPv4 detection returns only valid IPv4 values", async () => {
  const authModule = await importFresh(authModulePath);

  assert.equal(
    await authModule.resolvePublicIpv4({
      fetchImpl: async () => ({
        json: async () => ({ ip: "203.0.113.9" }),
      }),
    }),
    "203.0.113.9",
  );
  assert.equal(
    await authModule.resolvePublicIpv4({
      fetchImpl: async () => ({
        json: async () => ({ ip: "not-an-ip" }),
      }),
    }),
    null,
  );
});
