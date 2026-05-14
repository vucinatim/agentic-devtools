import assert from "node:assert/strict";
import { test } from "vitest";
import { createJsonResult } from "../../src/core/result.mjs";
import { getTool, listTools } from "../../src/core/tool-registry.mjs";

test("createJsonResult returns MCP text and structured content", () => {
  const payload = { ok: true, nested: { value: 1 } };
  const result = createJsonResult(payload);

  assert.deepEqual(result.structuredContent, payload);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
});

test("getTool returns registered tools", () => {
  assert.equal(getTool("namecheap").name, "namecheap");
  assert.equal(getTool("railway").name, "railway");
  assert.equal(getTool("npm").name, "npm");
  assert.equal(getTool("namecheap").mcpModule, "./tools/namecheap/mcp.mjs");
  assert.equal(getTool("railway").mcpModule, "./tools/railway/mcp.mjs");
  assert.equal(getTool("npm").mcpModule, "./tools/npm/mcp.mjs");
  assert.deepEqual(
    listTools().map((tool) => tool.name),
    ["namecheap", "railway", "npm"],
  );
});

test("getTool rejects unknown tool names with available options", () => {
  assert.throws(
    () => getTool("unknown"),
    /Unknown tool "unknown".*namecheap, railway, npm/,
  );
});
