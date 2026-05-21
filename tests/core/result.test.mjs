import assert from "node:assert/strict";
import { test } from "vitest";
import {
  CapabilityMissingError,
  ERROR_CODES,
  REMEDIATION_KINDS,
  createJsonResult,
  defaultsForCode,
  fail,
  mapHttpStatusToCode,
  ok,
  wrapToolHandler,
} from "../../src/core/result.mjs";

test("ok() wraps value in MCP text + structuredContent", () => {
  const payload = { ok: true, value: 42 };
  const result = ok(payload);

  assert.deepEqual(result.structuredContent, payload);
  assert.equal(result.content[0].type, "text");
  assert.deepEqual(JSON.parse(result.content[0].text), payload);
});

test("createJsonResult is an alias of ok (back-compat)", () => {
  assert.equal(createJsonResult, ok);
});

test("fail() produces the canonical error shape", () => {
  const result = fail({
    code: "PERMISSION_DENIED",
    message: "Token lacks R2 write",
    why: "Missing scope",
    remediation: {
      kind: "reconnect",
      url: "https://example.com/tokens",
      instructions: "Reconnect with broader scope.",
    },
    retriable: false,
  });

  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.error, true);
  assert.equal(result.structuredContent.code, "PERMISSION_DENIED");
  assert.equal(result.structuredContent.message, "Token lacks R2 write");
  assert.equal(result.structuredContent.remediation.kind, "reconnect");
  assert.equal(result.structuredContent.retriable, false);
});

test("fail() defaults unknown codes to UNKNOWN", () => {
  const result = fail({ code: "BANANA", message: "huh" });
  assert.equal(result.structuredContent.code, "UNKNOWN");
});

test("fail() defaults missing message", () => {
  const result = fail({ code: "TRANSIENT" });
  assert.equal(result.structuredContent.message, "Tool call failed");
});

test("mapHttpStatusToCode handles each status family", () => {
  assert.equal(mapHttpStatusToCode(401), ERROR_CODES.AUTH_EXPIRED);
  assert.equal(mapHttpStatusToCode(403), ERROR_CODES.PERMISSION_DENIED);
  assert.equal(mapHttpStatusToCode(404), ERROR_CODES.NOT_FOUND);
  assert.equal(mapHttpStatusToCode(429), ERROR_CODES.RATE_LIMITED);
  assert.equal(mapHttpStatusToCode(500), ERROR_CODES.TRANSIENT);
  assert.equal(mapHttpStatusToCode(502), ERROR_CODES.TRANSIENT);
  assert.equal(mapHttpStatusToCode(400), ERROR_CODES.VALIDATION_ERROR);
  assert.equal(mapHttpStatusToCode(422), ERROR_CODES.VALIDATION_ERROR);
  assert.equal(mapHttpStatusToCode(418), ERROR_CODES.UNKNOWN);
});

test("mapHttpStatusToCode picks PERMISSION_DENIED for 403 with scope text", () => {
  assert.equal(
    mapHttpStatusToCode(403, [{ message: "Missing scope: r2:write" }]),
    ERROR_CODES.PERMISSION_DENIED,
  );
});

test("defaultsForCode supplies sane defaults", () => {
  const d = defaultsForCode(ERROR_CODES.RATE_LIMITED);
  assert.equal(d.code, ERROR_CODES.RATE_LIMITED);
  assert.equal(d.retriable, true);
  assert.equal(d.remediation.kind, REMEDIATION_KINDS.WAIT);
});

test("wrapToolHandler returns ok() on success", async () => {
  const handler = wrapToolHandler(async (args) => ({ doubled: args.x * 2 }));
  const result = await handler({ x: 21 });

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { doubled: 42 });
});

test("wrapToolHandler passes through pre-wrapped MCP results", async () => {
  const handler = wrapToolHandler(async () => ok({ already: "wrapped" }));
  const result = await handler({});

  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent, { already: "wrapped" });
});

test("wrapToolHandler catches CapabilityMissingError → CAPABILITY_MISSING", async () => {
  const handler = wrapToolHandler(async () => {
    throw new CapabilityMissingError({
      message: "Resend MCP server not implemented",
      why: "Tool author has not added Resend wrappings yet",
      remediation: {
        kind: REMEDIATION_KINDS.DASHBOARD,
        url: "https://resend.com",
        instructions: "Send the email manually from Resend dashboard.",
      },
    });
  });

  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "CAPABILITY_MISSING");
  assert.equal(result.structuredContent.remediation.url, "https://resend.com");
});

test("wrapToolHandler falls back to UNKNOWN for unrecognized errors", async () => {
  const handler = wrapToolHandler(async () => {
    throw new Error("random boom");
  });

  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "UNKNOWN");
  assert.equal(result.structuredContent.message, "random boom");
});

test("wrapToolHandler uses mapError when supplied", async () => {
  const handler = wrapToolHandler(
    async () => {
      const err = new Error("403 Forbidden");
      err.name = "CustomProviderError";
      err.details = { status: 403 };
      throw err;
    },
    {
      mapError: (err) => {
        if (err.name === "CustomProviderError") {
          return {
            code: ERROR_CODES.PERMISSION_DENIED,
            message: err.message,
            remediation: {
              kind: REMEDIATION_KINDS.RECONNECT,
              instructions: "Reconnect with broader scope.",
            },
          };
        }
        return null;
      },
    },
  );

  const result = await handler({});
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "PERMISSION_DENIED");
  assert.equal(result.structuredContent.remediation.kind, "reconnect");
});
