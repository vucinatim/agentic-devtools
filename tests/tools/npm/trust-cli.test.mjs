import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildNpmTrustGithubArgs,
  buildNpmWebLoginArgs,
} from "../../../src/tools/npm/trust-cli.mjs";

test("builds npm trust github command arguments", () => {
  assert.deepEqual(
    buildNpmTrustGithubArgs({
      packageName: "@scope/pkg",
      repository: "scope/repo",
      workflowFile: "publish.yml",
    }),
    [
      "npm@^11.10.0",
      "trust",
      "github",
      "@scope/pkg",
      "--repo",
      "scope/repo",
      "--file",
      "publish.yml",
      "--yes",
    ],
  );
});

test("builds npm web login command arguments", () => {
  assert.deepEqual(buildNpmWebLoginArgs(), [
    "npm@^11.10.0",
    "login",
    "--auth-type=web",
    "--registry",
    "https://registry.npmjs.org",
  ]);
});

test("builds npm trust github command arguments with environment", () => {
  assert.deepEqual(
    buildNpmTrustGithubArgs({
      packageName: "@scope/pkg",
      repository: "scope/repo",
      workflowFile: "publish.yml",
      environment: "production",
      yes: false,
    }),
    [
      "npm@^11.10.0",
      "trust",
      "github",
      "@scope/pkg",
      "--repo",
      "scope/repo",
      "--file",
      "publish.yml",
      "--env",
      "production",
    ],
  );
});
