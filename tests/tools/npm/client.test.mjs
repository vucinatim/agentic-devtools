import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import {
  createNpmClient,
  encodePackageName,
  NpmRegistryError,
} from "../../../src/tools/npm/client.mjs";

test("encodes scoped package names for registry endpoints", () => {
  assert.equal(encodePackageName("@scope/pkg"), "%40scope%2Fpkg");
});

test("fetches package metadata and derives versions and dist-tags", async () => {
  const client = createNpmClient({
    env: {},
    fetchImpl: async (url) => {
      assert.equal(url, "https://registry.npmjs.org/%40scope%2Fpkg");
      return jsonResponse({
        name: "@scope/pkg",
        description: "Package",
        "dist-tags": { latest: "1.1.0", next: "2.0.0-beta.1" },
        versions: {
          "1.0.0": {},
          "1.1.0": {},
        },
      });
    },
  });

  assert.deepEqual(await client.getPackageVersions("@scope/pkg"), {
    packageName: "@scope/pkg",
    latest: "1.1.0",
    versions: ["1.0.0", "1.1.0"],
  });
  assert.deepEqual(await client.getPackageDistTags("@scope/pkg"), {
    packageName: "@scope/pkg",
    distTags: { latest: "1.1.0", next: "2.0.0-beta.1" },
  });
});

test("checks package name availability from 404 metadata response", async () => {
  const client = createNpmClient({
    env: {},
    fetchImpl: async () =>
      jsonResponse({ error: "Not found" }, { ok: false, status: 404 }),
  });

  assert.deepEqual(await client.checkPackageNameAvailability("available-name"), {
    packageName: "available-name",
    available: true,
    version: null,
    description: null,
  });
});

test("uses bearer token for authenticated npm requests", async () => {
  const calls = [];
  const client = createNpmClient({
    env: {
      NPM_TOKEN: "npm-token",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ username: "tim" });
    },
  });

  const user = await client.getCurrentUser();

  assert.equal(user.username, "tim");
  assert.equal(calls[0].url, "https://registry.npmjs.org/-/whoami");
  assert.equal(calls[0].init.headers.Authorization, "Bearer npm-token");
});

test("adds GitHub trusted publisher configuration with OTP header", async () => {
  const calls = [];
  const client = createNpmClient({
    env: {
      NPM_TOKEN: "npm-token",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse([{ id: "config-id" }]);
    },
  });

  await client.addGitHubTrustedPublisher({
    packageName: "@scope/pkg",
    repository: "scope/repo",
    workflowFile: "publish.yml",
    otp: "123456",
  });

  assert.equal(
    calls[0].url,
    "https://registry.npmjs.org/-/package/%40scope%2Fpkg/trust",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["npm-otp"], "123456");
  assert.deepEqual(JSON.parse(calls[0].init.body), [
    {
      type: "github",
      claims: {
        repository: "scope/repo",
        workflow_ref: { file: "publish.yml" },
      },
    },
  ]);
});

test("rejects authenticated calls without npm auth", async () => {
  const client = createNpmClient({
    env: {},
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    () => client.getCurrentUser(),
    (error) =>
      error instanceof NpmRegistryError &&
      error.message.includes("Missing npm token"),
  );
});

test("requires explicit confirmation before real local publish", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "npm-publish-"));
  await writeFile(
    path.join(tempDir, "package.json"),
    JSON.stringify({
      name: "@scope/pkg",
      version: "1.2.3",
    }),
  );
  const client = createNpmClient({
    env: {
      NPM_TOKEN: "npm-token",
    },
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    () =>
      client.publishPackageDirectory({
        cwd: tempDir,
        dryRun: false,
        confirm: "publish wrong",
      }),
    (error) =>
      error instanceof NpmRegistryError &&
      error.message.includes("publish @scope/pkg@1.2.3"),
  );
});

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});
