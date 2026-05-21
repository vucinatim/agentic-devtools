# Zero Frame integration plan — `0.1.9`

> Mirror of the canonical plan at
> `/Users/timvucina/Desktop/zeroframe/docs/agentic-devtools-rebuild.md`.
> The canonical doc lives in the consuming repo (Zero Frame) because the contract
> is driven by what agents need to do in projects. This mirror exists so
> contributors to agentic-devtools have the full context without leaving the repo.

## TL;DR

Three changes, threaded through:

1. **Structured error result on every tool failure** —
   `{ code, message, why, remediation: { kind, url, instructions }, retriable }`.
   The MCP SDK currently flattens `CloudflareApiError.details` to a string;
   this rebuild wraps every tool handler in middleware that maps provider errors
   to a stable schema.

2. **Scope-aware connect** — required scopes declared in
   `src/core/capabilities.mjs`, displayed to the user at connect, probed
   against the real API after paste, reported as `{ granted, missing }`.

3. **`cloudflare.createR2ApiToken`** — programmatic R2 S3 key minting via
   `POST /user/tokens` with the `Workers R2 Storage Bucket Item Write`
   permission group. Cloudflare's API has supported this since 2024; the gap
   was implementation, not capability.

## Scope of work

### Touched files

- `src/core/result.mjs` — rewritten (13 → ~80 lines)
- `src/core/capabilities.mjs` — new
- `src/core/resolve-resource.mjs` — new (lifted from `cloudflare/client.mjs`)
- `src/tools/cloudflare/client.mjs` — `createR2ApiToken` added, dedup helpers
- `src/tools/cloudflare/auth.mjs` — scope probe; save-after-validate
- `src/tools/cloudflare/mcp.mjs` — all handlers wrapped in `wrapToolHandler`
- `src/tools/railway/mcp.mjs` — same; uses lifted `createToolResult`
- `src/tools/namecheap/mcp.mjs` — uses lifted `createToolResult`
- `src/tools/npm/mcp.mjs` — uses lifted `createToolResult`
- `tests/` — error-mapping tests + updated MCP result-shape tests

### NOT touched

- Provider API clients themselves (Cloudflare/Railway/Namecheap/npm `client.mjs`)
  beyond the `createR2ApiToken` add and helper dedup — they are well-built and
  do not need a rebuild.
- OAuth flow infrastructure — providers we care about are token-based.
- Temporary credentials API for R2 (Path B) — useful but not demo-critical.
- Per-operation capability declarations — per-flow is enough.

## The error contract

```ts
type ToolError = {
  code: ErrorCode,                    // see enum below
  message: string,                    // human-readable
  why?: string,                       // diagnostic detail
  remediation?: {
    kind: "reconnect" | "dashboard" | "retry" | "wait" | "code_change",
    url?: string,
    instructions?: string,
  },
  retriable?: boolean,
  provider_error?: unknown,           // raw payload for debug
};

type ErrorCode =
  | "PERMISSION_DENIED"   // 403 with scope-related provider error
  | "CAPABILITY_MISSING"  // tool tried to call an op the API doesn't support
  | "NOT_FOUND"           // 404
  | "RATE_LIMITED"        // 429
  | "TRANSIENT"           // 5xx, network
  | "VALIDATION_ERROR"    // 400 with field-level error
  | "AUTH_EXPIRED"        // 401
  | "UNKNOWN";            // catch-all; should be rare after wiring is complete
```

### Mapping rules (default in `wrapToolHandler`)

| Provider signal | → `code` | → `remediation.kind` |
|---|---|---|
| HTTP 401 | `AUTH_EXPIRED` | `reconnect` |
| HTTP 403 + scope error | `PERMISSION_DENIED` | `reconnect` |
| HTTP 403 + other | `PERMISSION_DENIED` | `dashboard` |
| HTTP 404 | `NOT_FOUND` | `code_change` |
| HTTP 429 | `RATE_LIMITED` | `wait` |
| HTTP 5xx / network | `TRANSIENT` | `retry` |
| HTTP 400 | `VALIDATION_ERROR` | `code_change` |
| `CapabilityMissingError` thrown from client | `CAPABILITY_MISSING` | `dashboard` |

Tools can pass override-options to `fail()` for non-default mappings.

## `core/capabilities.mjs` shape

```js
export const CAPABILITIES = {
  cloudflare: {
    scopes: [
      {
        id: "com.cloudflare.api.account.r2.bucket.edit",   // permission group ID
        display: "Account: R2 Storage (Edit)",
        needed_for: ["create R2 buckets", "mint R2 S3 keys"],
      },
      {
        id: "com.cloudflare.api.user.api_tokens.write",
        display: "Account: API Tokens (Write)",
        needed_for: ["mint R2 S3 keys"],
      },
      // ...
    ],
    dashboard_token_url:
      "https://dash.cloudflare.com/profile/api-tokens",
    bootstrap_note:
      "Cloudflare requires the first 'API Tokens:Write' token to be created via dashboard. After that, all R2 operations are programmatic.",
  },
  railway: { /* ... */ },
};
```

Read by:
- `connect` flow (display + dashboard link)
- `validateToken` (scope probe)
- Future: `bun zero doctor` (cross-check current connections against required scopes)

## `wrapToolHandler` sketch

```js
import { fail, ok } from "./result.mjs";
import { CloudflareApiError } from "../tools/cloudflare/client.mjs";
import { RailwayApiError }    from "../tools/railway/client.mjs";

export function wrapToolHandler(handler) {
  return async (args, extra) => {
    try {
      const value = await handler(args, extra);
      return ok(value);
    } catch (err) {
      if (err instanceof CloudflareApiError) {
        return fail(mapCloudflareError(err));
      }
      if (err instanceof RailwayApiError) {
        return fail(mapRailwayError(err));
      }
      if (err?.name === "CapabilityMissingError") {
        return fail({
          code: "CAPABILITY_MISSING",
          message: err.message,
          why: err.why,
          remediation: err.remediation,
        });
      }
      return fail({
        code: "UNKNOWN",
        message: err?.message ?? "Unknown tool error",
        provider_error: { name: err?.name, stack: err?.stack },
      });
    }
  };
}
```

Per-tool registration becomes:

```js
server.registerTool(
  "cloudflare_create_r2_bucket",
  { description: "...", inputSchema: { ... } },
  wrapToolHandler(async ({ name, location_hint }) => {
    return await client.createR2Bucket({ name, locationHint: location_hint });
  }),
);
```

## Cleanup pass (on the way through)

1. Delete `createToolResult` duplicates in `railway/mcp.mjs:33`,
   `namecheap/mcp.mjs:53`, `npm/mcp.mjs:34`. All import from `core/result.mjs`.
2. Delete `pickString` / `compactObject` duplicates in `cloudflare/client.mjs`;
   import from `core/config-store.mjs`.
3. Lift `resolveSingleNamedResource` from `cloudflare/client.mjs:1189` into
   `core/resolve-resource.mjs`. Update import in cloudflare. Make available for
   other providers (used opportunistically as they pick up the pattern).
4. Unify auth-status payload shape across providers:
   `{ configured, source, scopes_granted, scopes_missing, last_validated_at }`.
5. Move cloudflare's save-then-validate to validate-then-save.

## Tests

- `tests/core/result.test.mjs` — `ok()`/`fail()` shape; `wrapToolHandler`
  wraps + catches synchronously and async; default mapping table works for each
  HTTP status + each custom error class.
- `tests/cloudflare/r2-token.test.mjs` — hits a mock for
  `POST /user/tokens`; verifies SHA-256 hashing of `value`; verifies returned
  shape `{ accessKeyId, secretAccessKey }`.
- Update existing tests where MCP result shape changed (the success shape
  doesn't change; only the error shape does).

## Publishing

- Bump version to `0.1.9` in `package.json`.
- Update `CHANGELOG.md` (or README's changelog section) with the new error
  contract + `createR2ApiToken` + scope probe.
- `npm publish` (Tim does this, or follow `docs/publishing.md`).

## Sequence (across both repos)

See canonical plan for the full Gantt. agentic-devtools-side work is May 21–22.
Zero Frame template-side work is May 23.

## Verification (agentic-devtools side)

- `npm test` green
- `npm pack` produces a clean tarball
- A scratch script in `scripts/` calls `createR2ApiToken` against a test
  Cloudflare account and round-trips an S3 PUT/GET with the returned credentials
- `agentic-devtools connect cloudflare` prints the new UX
- Forcing a 403 (e.g. revoke a scope) returns the structured error with
  `kind: "reconnect"` and a dashboard URL

## Open questions

Resolved at planning. Bootstrap UX = option A (explicit one-time onboarding).
Remediation enum = 5 values. No outstanding architectural decisions.
