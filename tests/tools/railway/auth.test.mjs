import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "vitest";

const importFresh = async (modulePath) =>
  import(`${pathToFileURL(modulePath).href}?t=${Date.now()}-${Math.random()}`);

test("Railway auth config can be saved and resolved from a local file", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "railway-auth-"));
  const authPath = path.join(tempDir, "railway.json");

  process.env.RAILWAY_AUTH_CONFIG_PATH = authPath;
  delete process.env.RAILWAY_PROJECT_TOKEN;
  delete process.env.RAILWAY_API_TOKEN;
  delete process.env.RAILWAY_TOKEN;
  delete process.env.RAILWAY_PROJECT_ID;
  delete process.env.RAILWAY_API_ENDPOINT;

  const authModule = await importFresh(
    "/Users/timvucina/Desktop/MyProjects/agentic-devtools/src/tools/railway/auth.mjs",
  );

  await authModule.saveRailwayAuthConfig({
    token: "project-token",
    kind: "project",
    defaultProjectId: "project-id",
  });

  const raw = JSON.parse(await readFile(authPath, "utf8"));
  assert.equal(raw.token, "project-token");

  assert.deepEqual(authModule.resolveRailwayApiToken(process.env), {
    token: "project-token",
    kind: "project",
    source: "file",
  });

  const status = authModule.getRailwayAuthStatus(process.env);
  assert.equal(status.configured, true);
  assert.equal(status.kind, "project");
  assert.equal(status.source, "file");
  assert.equal(status.defaultProjectId, "project-id");
  assert.equal("token" in status, false);
});

test("Railway client can use stored auth config without token env vars", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "railway-auth-"));
  const authPath = path.join(tempDir, "railway.json");

  process.env.RAILWAY_AUTH_CONFIG_PATH = authPath;
  delete process.env.RAILWAY_PROJECT_TOKEN;
  delete process.env.RAILWAY_API_TOKEN;
  delete process.env.RAILWAY_TOKEN;

  const authModule = await importFresh(
    "/Users/timvucina/Desktop/MyProjects/agentic-devtools/src/tools/railway/auth.mjs",
  );
  await authModule.saveRailwayAuthConfig({
    token: "account-token",
    kind: "account",
    endpoint: "https://example.test/graphql",
  });

  const { createRailwayClient } = await importFresh(
    "/Users/timvucina/Desktop/MyProjects/agentic-devtools/src/tools/railway/client.mjs",
  );
  const calls = [];
  const client = createRailwayClient({
    env: { RAILWAY_AUTH_CONFIG_PATH: authPath },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: { me: { name: "Tim", email: "tim@example.com", workspaces: [] } },
        }),
        text: async () => "",
      };
    },
  });

  await client.getCurrentViewer();

  assert.equal(client.auth.source, "file");
  assert.equal(calls[0].url, "https://example.test/graphql");
  assert.equal(calls[0].init.headers.Authorization, "Bearer account-token");
});

test("Railway environment tokens override stored auth config", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "railway-auth-"));
  const authPath = path.join(tempDir, "railway.json");

  process.env.RAILWAY_AUTH_CONFIG_PATH = authPath;
  delete process.env.RAILWAY_PROJECT_TOKEN;
  delete process.env.RAILWAY_API_TOKEN;
  delete process.env.RAILWAY_TOKEN;

  const authModule = await importFresh(
    "/Users/timvucina/Desktop/MyProjects/agentic-devtools/src/tools/railway/auth.mjs",
  );

  await authModule.saveRailwayAuthConfig({
    token: "file-token",
    kind: "project",
  });

  assert.deepEqual(
    authModule.resolveRailwayApiToken({
      RAILWAY_AUTH_CONFIG_PATH: authPath,
      RAILWAY_API_TOKEN: "account-token",
    }),
    {
      token: "account-token",
      kind: "account",
      source: "env:RAILWAY_API_TOKEN",
    },
  );
});
