import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createNamecheapClient,
  createNpmClient,
  createRailwayClient,
  listTools,
  resolveRailwayApiToken,
} from "../../src/index.mjs";

test("root package export exposes stable public helpers", () => {
  assert.equal(typeof createNamecheapClient, "function");
  assert.equal(typeof createRailwayClient, "function");
  assert.equal(typeof createNpmClient, "function");
  assert.equal(typeof resolveRailwayApiToken, "function");
});

test("tool registry exposes the current public tool set", () => {
  assert.deepEqual(
    listTools().map((tool) => tool.name),
    ["namecheap", "railway", "npm"],
  );
});
