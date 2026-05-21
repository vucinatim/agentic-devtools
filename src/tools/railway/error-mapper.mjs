/**
 * Map RailwayApiError → structured fail() args.
 *
 * Railway returns GraphQL errors; this mapper unwraps `.details.errors[]` for
 * the canonical error message and uses the HTTP status to pick a code.
 */

import {
  ERROR_CODES,
  REMEDIATION_KINDS,
  defaultsForCode,
  mapHttpStatusToCode,
} from "../../core/result.mjs";

const DASHBOARD_TOKENS_URL = "https://railway.com/account/tokens";

export const mapRailwayError = (err) => {
  if (!err || err.name !== "RailwayApiError") {
    return null;
  }

  const details = err.details ?? {};
  const status = typeof details.status === "number" ? details.status : null;
  const providerErrors = Array.isArray(details.errors) ? details.errors : [];

  if (status === null) {
    const message = err.message ?? "Railway request failed";
    if (/missing.*token/i.test(message) || /run.*connect/i.test(message)) {
      return {
        code: ERROR_CODES.AUTH_EXPIRED,
        message,
        why: "No Railway token is configured.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          instructions:
            "Run `agentic-devtools connect railway` or set RAILWAY_API_TOKEN / RAILWAY_PROJECT_TOKEN.",
        },
        retriable: false,
      };
    }
    if (/requires an account token/i.test(message)) {
      return {
        code: ERROR_CODES.PERMISSION_DENIED,
        message,
        why: "This operation requires an account-scoped token; a project-scoped token is in use.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          url: DASHBOARD_TOKENS_URL,
          instructions:
            "Create or paste an account token via `agentic-devtools connect railway` (the dashboard URL gives the right token type).",
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
          "Check the arguments — a required value (project id, env id, etc.) was missing or invalid.",
      },
      retriable: false,
    };
  }

  const code = mapHttpStatusToCode(status, providerErrors);
  const base = defaultsForCode(code);

  if (code === ERROR_CODES.PERMISSION_DENIED) {
    return {
      ...base,
      code,
      message: err.message,
      why: `Railway returned HTTP ${status} — your token lacks permission for this operation.`,
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_TOKENS_URL,
        instructions:
          "Either re-create the token with broader scope, or use an account-level token via `agentic-devtools connect railway`.",
      },
      provider_error: { status, errors: providerErrors },
    };
  }

  if (code === ERROR_CODES.AUTH_EXPIRED) {
    return {
      ...base,
      code,
      message: err.message,
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        instructions: "Run `agentic-devtools connect railway` to re-authenticate.",
      },
      provider_error: { status, errors: providerErrors },
    };
  }

  return {
    ...base,
    code,
    message: err.message,
    provider_error: { status, errors: providerErrors },
  };
};
