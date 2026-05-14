import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const importFresh = async (modulePath) =>
  import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);

const authModulePath = path.join(process.cwd(), "src/tools/npm/auth.mjs");

test("npm auth resolves environment tokens first", async () => {
  const authModule = await importFresh(authModulePath);

  assert.deepEqual(
    authModule.resolveNpmAuthConfig({
      NPM_TOKEN: "npm-token",
      NODE_AUTH_TOKEN: "node-token",
    }),
    {
      token: "npm-token",
      registry: "https://registry.npmjs.org",
      source: "env:NPM_TOKEN",
    },
  );
});

test("npm auth can be saved and resolved from local config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "npm-auth-"));
  const authPath = path.join(tempDir, "npm.json");

  process.env.AGENTIC_DEVTOOLS_NPM_AUTH_CONFIG_PATH = authPath;
  delete process.env.NPM_TOKEN;
  delete process.env.NODE_AUTH_TOKEN;

  const authModule = await importFresh(authModulePath);
  await authModule.saveNpmAuthConfig({
    token: "stored-token",
    registry: "https://registry.npmjs.org/",
  });

  const status = authModule.getNpmAuthStatus(process.env);
  assert.equal(status.configured, true);
  assert.equal(status.source, "file");
  assert.equal(status.registry, "https://registry.npmjs.org");
  assert.equal("token" in status, false);
});

test("npm auth reads npmrc token when explicit user config is supplied", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "npm-auth-"));
  const npmrcPath = path.join(tempDir, ".npmrc");
  await writeFile(
    npmrcPath,
    "//registry.npmjs.org/:_authToken=npmrc-token\n",
  );

  const authModule = await importFresh(authModulePath);
  const auth = authModule.resolveNpmAuthConfig({
    NPM_CONFIG_USERCONFIG: npmrcPath,
  });

  assert.equal(auth.token, "npmrc-token");
  assert.equal(auth.source, `npmrc:${npmrcPath}`);
});
