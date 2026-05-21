/**
 * Map CloudflareApiError → structured fail() args.
 *
 * Wired into wrapToolHandler({ mapError }) for every Cloudflare MCP tool.
 * Reads `.details.status` and `.details.errors[]` to pick a sensible error code
 * + remediation. See `src/core/result.mjs` for the canonical mapping rules.
 */

import {
  ERROR_CODES,
  REMEDIATION_KINDS,
  defaultsForCode,
  mapHttpStatusToCode,
} from "../../core/result.mjs";

const DASHBOARD_TOKENS_URL = "https://dash.cloudflare.com/profile/api-tokens";

export const mapCloudflareError = (err) => {
  if (!err || err.name !== "CloudflareApiError") {
    return null;
  }

  const details = err.details ?? {};
  const status = typeof details.status === "number" ? details.status : null;
  const providerErrors = Array.isArray(details.errors) ? details.errors : [];

  // Pre-flight client-side errors (missing token, missing arg) have no HTTP
  // status. They're effectively validation errors from the agent's POV.
  if (status === null) {
    const message = err.message ?? "Cloudflare request failed";
    if (/missing.*token/i.test(message) || /run.*connect/i.test(message)) {
      return {
        code: ERROR_CODES.AUTH_EXPIRED,
        message,
        why: "No Cloudflare token is configured in this environment.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          instructions:
            "Run `agentic-devtools connect cloudflare` or set CLOUDFLARE_API_TOKEN.",
        },
        retriable: false,
      };
    }
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      remediation: {
        kind: REMEDIATION_KINDS.CODE_CHANGE,
        instructions:
          "Check the arguments passed to this tool — a required value was missing or malformed.",
      },
      retriable: false,
    };
  }

  const code = mapHttpStatusToCode(status, providerErrors);
  const base = defaultsForCode(code);

  // Attach Cloudflare-specific remediation hints.
  if (code === ERROR_CODES.PERMISSION_DENIED) {
    return {
      ...base,
      code,
      message: err.message,
      why: `Cloudflare returned HTTP ${status} — your API token is missing the required permission for this operation.`,
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_TOKENS_URL,
        instructions:
          "Open the Cloudflare API tokens page, edit the token (or create a new one), add the missing permission(s), then run `agentic-devtools connect cloudflare` to refresh.",
      },
      provider_error: { status, errors: providerErrors },
    };
  }

  if (code === ERROR_CODES.AUTH_EXPIRED) {
    return {
      ...base,
      code,
      message: err.message,
      why: "Cloudflare returned HTTP 401 — your token is invalid or revoked.",
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        instructions: "Run `agentic-devtools connect cloudflare` to re-authenticate.",
      },
      provider_error: { status, errors: providerErrors },
    };
  }

  if (code === ERROR_CODES.RATE_LIMITED) {
    return {
      ...base,
      code,
      message: err.message,
      why: "Cloudflare rate-limit reached. Back off before retrying.",
      remediation: {
        kind: REMEDIATION_KINDS.WAIT,
        instructions: "Wait 30-60 seconds and retry.",
      },
      provider_error: { status, errors: providerErrors },
    };
  }

  // Default mapping for the rest.
  return {
    ...base,
    code,
    message: err.message,
    provider_error: { status, errors: providerErrors },
  };
};
