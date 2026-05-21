/**
 * Tool result contract for agentic-devtools.
 *
 * Every MCP tool returns one of two shapes:
 *
 *   ok(value)
 *     { content: [{type:'text', text: JSON.stringify(value)}],
 *       structuredContent: value }
 *
 *   fail({ code, message, why?, remediation?, retriable?, provider_error? })
 *     { content: [{type:'text', text: JSON.stringify(errorObject)}],
 *       structuredContent: errorObject,
 *       isError: true }
 *
 * The `fail` shape is the agent-facing error contract. See
 * `docs/zeroframe-integration-plan.md` for the rationale and decision table.
 *
 * Use `wrapToolHandler(handler)` to wrap a tool's async handler — it catches
 * provider-specific errors and maps them to the structured fail shape so
 * individual handlers don't need their own try/catch.
 */

// -- Success -----------------------------------------------------------------

export const ok = (value) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ],
  structuredContent: value,
});

// Back-compat alias. Older modules import createJsonResult from this file.
// New code should use `ok`.
export const createJsonResult = ok;

export const printJson = (value) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
};

// -- Error contract ----------------------------------------------------------

/**
 * Canonical error codes. The agent uses these to decide its next action.
 *   PERMISSION_DENIED  — caller authenticated but lacks scope/perms
 *   CAPABILITY_MISSING — the provider's API does not support this op
 *   NOT_FOUND          — resource referenced does not exist
 *   RATE_LIMITED       — backoff and retry
 *   TRANSIENT          — 5xx / network glitch; safe to retry
 *   VALIDATION_ERROR   — caller passed bad input; change inputs, don't retry
 *   AUTH_EXPIRED       — credentials revoked or expired; reconnect
 *   UNKNOWN            — fell through all mapping; should be rare
 */
export const ERROR_CODES = Object.freeze({
  PERMISSION_DENIED: "PERMISSION_DENIED",
  CAPABILITY_MISSING: "CAPABILITY_MISSING",
  NOT_FOUND: "NOT_FOUND",
  RATE_LIMITED: "RATE_LIMITED",
  TRANSIENT: "TRANSIENT",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  AUTH_EXPIRED: "AUTH_EXPIRED",
  UNKNOWN: "UNKNOWN",
});

/**
 * Remediation kinds. The agent doesn't switch on these — it relays the
 * `instructions` + `url` to the user. The kind exists so the framework (or a
 * future orchestrator) can offer better defaults.
 */
export const REMEDIATION_KINDS = Object.freeze({
  RECONNECT: "reconnect",       // run `agentic-devtools connect <provider>`
  DASHBOARD: "dashboard",       // manual click in provider UI
  RETRY: "retry",               // safe to call again, optionally after delay
  WAIT: "wait",                 // rate-limited / async-pending; back off
  CODE_CHANGE: "code_change",   // caller inputs were wrong, not a flake
});

/**
 * Build a structured error result.
 *
 * @param {object} args
 * @param {string} args.code - one of ERROR_CODES
 * @param {string} args.message - human-readable summary
 * @param {string} [args.why] - diagnostic detail
 * @param {object} [args.remediation] - { kind, url?, instructions? }
 * @param {boolean} [args.retriable]
 * @param {unknown} [args.provider_error] - raw provider payload for debug
 */
export const fail = ({
  code,
  message,
  why,
  remediation,
  retriable,
  provider_error,
}) => {
  if (!code || !ERROR_CODES[code]) {
    code = ERROR_CODES.UNKNOWN;
  }
  if (!message || typeof message !== "string") {
    message = "Tool call failed";
  }

  const errorObject = {
    error: true,
    code,
    message,
    ...(why ? { why } : {}),
    ...(remediation ? { remediation } : {}),
    ...(retriable !== undefined ? { retriable } : {}),
    ...(provider_error ? { provider_error } : {}),
  };

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(errorObject, null, 2),
      },
    ],
    structuredContent: errorObject,
    isError: true,
  };
};

// -- Mapping rules -----------------------------------------------------------

/**
 * Default remediation kind for a given error code. Tools can override by
 * passing their own remediation when calling `fail`.
 */
const DEFAULT_REMEDIATION_KIND = {
  PERMISSION_DENIED: REMEDIATION_KINDS.RECONNECT,
  CAPABILITY_MISSING: REMEDIATION_KINDS.DASHBOARD,
  NOT_FOUND: REMEDIATION_KINDS.CODE_CHANGE,
  RATE_LIMITED: REMEDIATION_KINDS.WAIT,
  TRANSIENT: REMEDIATION_KINDS.RETRY,
  VALIDATION_ERROR: REMEDIATION_KINDS.CODE_CHANGE,
  AUTH_EXPIRED: REMEDIATION_KINDS.RECONNECT,
  UNKNOWN: REMEDIATION_KINDS.RETRY,
};

const DEFAULT_RETRIABLE = {
  PERMISSION_DENIED: false,
  CAPABILITY_MISSING: false,
  NOT_FOUND: false,
  RATE_LIMITED: true,
  TRANSIENT: true,
  VALIDATION_ERROR: false,
  AUTH_EXPIRED: false,
  UNKNOWN: false,
};

/**
 * Map an HTTP status + provider error payload to an ErrorCode.
 * Used by per-provider error mappers; lives here so the rules are visible
 * in one place.
 */
export const mapHttpStatusToCode = (status, providerErrors = []) => {
  if (status === 401) return ERROR_CODES.AUTH_EXPIRED;
  if (status === 403) {
    // Many providers report "missing scope" / "insufficient permissions" via
    // text in the error array. Look for canonical phrases.
    const text = providerErrors
      .map((e) => `${e?.message ?? ""} ${e?.code ?? ""}`)
      .join(" ")
      .toLowerCase();
    if (
      text.includes("scope") ||
      text.includes("permission") ||
      text.includes("not authorized")
    ) {
      return ERROR_CODES.PERMISSION_DENIED;
    }
    return ERROR_CODES.PERMISSION_DENIED;
  }
  if (status === 404) return ERROR_CODES.NOT_FOUND;
  if (status === 429) return ERROR_CODES.RATE_LIMITED;
  if (status >= 500) return ERROR_CODES.TRANSIENT;
  if (status === 400 || status === 422) return ERROR_CODES.VALIDATION_ERROR;
  return ERROR_CODES.UNKNOWN;
};

// -- CapabilityMissingError --------------------------------------------------

/**
 * Throw this from a client when a tool is called for an operation the
 * underlying provider API does not (yet) expose. Carries dashboard URL +
 * instructions so the agent has a clean handoff.
 */
export class CapabilityMissingError extends Error {
  constructor({ message, why, remediation }) {
    super(message);
    this.name = "CapabilityMissingError";
    this.why = why;
    this.remediation = remediation;
  }
}

// -- Middleware --------------------------------------------------------------

/**
 * Wrap an async tool handler so any thrown error becomes a structured `fail`
 * result. Supply optional `mapError` for provider-specific mapping; the default
 * mapping handles generic errors and CapabilityMissingError.
 *
 * Usage:
 *   server.registerTool("foo", spec, wrapToolHandler(async (args) => {
 *     const value = await doWork(args);
 *     return value; // wrapped in ok(...) automatically
 *   }, { mapError: mapCloudflareError }));
 */
export const wrapToolHandler = (handler, { mapError } = {}) => {
  return async (args, extra) => {
    try {
      const value = await handler(args, extra);

      // If the handler already returned a structured result (legacy code or
      // explicit fail), pass it through unchanged.
      if (
        value &&
        typeof value === "object" &&
        Array.isArray(value.content) &&
        ("isError" in value || "structuredContent" in value)
      ) {
        return value;
      }

      return ok(value);
    } catch (err) {
      if (err instanceof CapabilityMissingError) {
        return fail({
          code: ERROR_CODES.CAPABILITY_MISSING,
          message: err.message,
          why: err.why,
          remediation: err.remediation ?? {
            kind: REMEDIATION_KINDS.DASHBOARD,
          },
          retriable: false,
        });
      }

      if (typeof mapError === "function") {
        const mapped = mapError(err);
        if (mapped) {
          return fail(mapped);
        }
      }

      // Unknown error fallback. Keep the raw message visible to the agent.
      return fail({
        code: ERROR_CODES.UNKNOWN,
        message: err?.message ?? "Tool call failed with an unknown error",
        provider_error: {
          name: err?.name,
          stack: err?.stack,
        },
      });
    }
  };
};

/**
 * Helper for provider-specific error mappers: builds a fail-args object with
 * sensible defaults derived from the code. Mappers can spread + override.
 */
export const defaultsForCode = (code) => ({
  code,
  retriable: DEFAULT_RETRIABLE[code] ?? false,
  remediation: {
    kind: DEFAULT_REMEDIATION_KIND[code] ?? REMEDIATION_KINDS.RETRY,
  },
});
