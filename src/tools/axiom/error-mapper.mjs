/**
 * Map AxiomApiError → structured fail() args.
 *
 * Axiom's REST API uses standard HTTP status codes. Token issues come back
 * as 401/403 with a JSON body containing `{ message }` or `{ error }`.
 */

import {
  ERROR_CODES,
  REMEDIATION_KINDS,
  defaultsForCode,
  mapHttpStatusToCode,
} from "../../core/result.mjs";

const DASHBOARD_TOKEN_URL = "https://app.axiom.co/settings/api-tokens";

export const mapAxiomError = (err) => {
  if (!err || err.name !== "AxiomApiError") {
    return null;
  }

  const details = err.details ?? {};
  const status = typeof details.status === "number" ? details.status : null;
  const payload = details.payload ?? null;

  // Pre-flight (no HTTP attempt — bad config / bad args).
  if (status === null) {
    const message = err.message ?? "Axiom request failed";
    if (/missing.*token/i.test(message) || /run.*connect/i.test(message)) {
      return {
        code: ERROR_CODES.AUTH_EXPIRED,
        message,
        why: "No Axiom token is configured in this environment.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          url: DASHBOARD_TOKEN_URL,
          instructions:
            "Run `agentic-devtools connect axiom` and paste an API token with Query permission (and Ingest if you also send events).",
        },
        retriable: false,
      };
    }
    if (/requires \{/i.test(message)) {
      return {
        code: ERROR_CODES.VALIDATION_ERROR,
        message,
        remediation: {
          kind: REMEDIATION_KINDS.CODE_CHANGE,
          instructions:
            "Re-check the arguments — a required input (apl, dataset, traceId, etc.) was missing.",
        },
        retriable: false,
      };
    }
    return {
      code: ERROR_CODES.UNKNOWN,
      message,
      retriable: false,
    };
  }

  // 401 — token bad / missing
  if (status === 401) {
    return {
      ...defaultsForCode(ERROR_CODES.AUTH_EXPIRED),
      message: err.message,
      why: "Axiom rejected the API token — it may be invalid or revoked.",
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_TOKEN_URL,
        instructions:
          "Run `agentic-devtools connect axiom` to paste a fresh token.",
      },
      provider_error: { status, payload },
    };
  }

  // 403 — token valid but missing scope
  if (status === 403) {
    return {
      ...defaultsForCode(ERROR_CODES.PERMISSION_DENIED),
      message: err.message,
      why:
        "Axiom token lacks the required permission for this operation (likely Query, or Ingest if you're writing events).",
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_TOKEN_URL,
        instructions:
          "Create a new Axiom token with the required permission(s), then re-run `agentic-devtools connect axiom`.",
      },
      provider_error: { status, payload },
    };
  }

  // 404 — dataset / resource not found
  if (status === 404) {
    return {
      ...defaultsForCode(ERROR_CODES.NOT_FOUND),
      message: err.message,
      why:
        "Axiom couldn't find the requested dataset or resource. Most common cause: a dataset name mismatch (case-sensitive).",
      remediation: {
        kind: REMEDIATION_KINDS.CODE_CHANGE,
        instructions:
          "Call `axiom_list_datasets` to see the exact names available. The dataset must exist before queries can run.",
      },
      provider_error: { status, payload },
    };
  }

  if (status === 429) {
    return {
      ...defaultsForCode(ERROR_CODES.RATE_LIMITED),
      message: err.message,
      why: "Axiom rate-limit reached.",
      remediation: {
        kind: REMEDIATION_KINDS.WAIT,
        instructions: "Wait 30-60 seconds and retry.",
      },
      provider_error: { status, payload },
    };
  }

  if (status >= 500) {
    return {
      ...defaultsForCode(ERROR_CODES.TRANSIENT),
      message: err.message,
      remediation: {
        kind: REMEDIATION_KINDS.RETRY,
        instructions:
          "Axiom transient error. Safe to retry — back off briefly first.",
      },
      provider_error: { status, payload },
    };
  }

  if (status === 400 || status === 422) {
    return {
      ...defaultsForCode(ERROR_CODES.VALIDATION_ERROR),
      message: err.message,
      why:
        "Axiom rejected the request as invalid — usually a malformed APL query or unknown field reference.",
      remediation: {
        kind: REMEDIATION_KINDS.CODE_CHANGE,
        instructions:
          "Check the APL syntax. Field references are case-sensitive. Call `axiom_get_dataset` to inspect available fields, or test the query in Axiom's UI first.",
      },
      provider_error: { status, payload },
    };
  }

  // Fall back to the generic status mapping.
  const code = mapHttpStatusToCode(status, []);
  return {
    ...defaultsForCode(code),
    message: err.message,
    provider_error: { status, payload },
  };
};
