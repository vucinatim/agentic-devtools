/**
 * Map NpmRegistryError → structured fail() args.
 *
 * The npm registry exposes typical HTTP error codes. Token-related failures
 * usually come back as 401 / 403 with a payload like `{ error: "...", code: "..." }`.
 */

import {
  ERROR_CODES,
  REMEDIATION_KINDS,
  defaultsForCode,
  mapHttpStatusToCode,
} from "../../core/result.mjs";

const DASHBOARD_URL = "https://www.npmjs.com/settings/~/tokens";

export const mapNpmError = (err) => {
  if (!err || err.name !== "NpmRegistryError") {
    return null;
  }

  const details = err.details ?? {};
  const status = typeof details.status === "number" ? details.status : null;
  const payload = details.payload ?? null;

  // Pre-flight: no HTTP call attempted (missing token, missing arg, etc.)
  if (status === null) {
    const message = err.message ?? "npm request failed";
    if (/missing.*token/i.test(message) || /connect npm/i.test(message)) {
      return {
        code: ERROR_CODES.AUTH_EXPIRED,
        message,
        why: "No npm token is configured.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          url: DASHBOARD_URL,
          instructions:
            "Run `agentic-devtools connect npm` or set NPM_TOKEN / NODE_AUTH_TOKEN.",
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
          "Check the tool arguments — a required value (package name, etc.) was missing or invalid.",
      },
      retriable: false,
    };
  }

  // 401 — token bad / missing 2FA / OTP required
  if (status === 401) {
    const text = JSON.stringify(payload ?? {}).toLowerCase();
    if (text.includes("otp") || text.includes("2fa")) {
      return {
        ...defaultsForCode(ERROR_CODES.PERMISSION_DENIED),
        message: err.message,
        why: "npm requires a one-time password (2FA) for this operation.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          url: DASHBOARD_URL,
          instructions:
            "Use an Automation token (which bypasses 2FA) or grant the publish operation in npm's web UI.",
        },
        provider_error: { status, payload },
      };
    }
    return {
      ...defaultsForCode(ERROR_CODES.AUTH_EXPIRED),
      message: err.message,
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_URL,
        instructions:
          "Run `agentic-devtools connect npm` to re-authenticate, or generate a fresh Automation token.",
      },
      provider_error: { status, payload },
    };
  }

  if (status === 403) {
    return {
      ...defaultsForCode(ERROR_CODES.PERMISSION_DENIED),
      message: err.message,
      why:
        "npm token does not have permission for this operation (publish scope, granular package access, etc.).",
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_URL,
        instructions:
          "Use an Automation or granular token that includes the required scope for this package, then re-run `agentic-devtools connect npm`.",
      },
      provider_error: { status, payload },
    };
  }

  if (status === 429) {
    return {
      ...defaultsForCode(ERROR_CODES.RATE_LIMITED),
      message: err.message,
      remediation: {
        kind: REMEDIATION_KINDS.WAIT,
        instructions: "npm rate-limit reached. Back off and retry in 30-60 seconds.",
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
        instructions: "Transient npm registry error. Safe to retry.",
      },
      provider_error: { status, payload },
    };
  }

  if (status === 404) {
    return {
      ...defaultsForCode(ERROR_CODES.NOT_FOUND),
      message: err.message,
      remediation: {
        kind: REMEDIATION_KINDS.CODE_CHANGE,
        instructions:
          "Package or version not found on the registry. Verify the package name and version.",
      },
      provider_error: { status, payload },
    };
  }

  // Fall back to the generic mapping.
  const code = mapHttpStatusToCode(status, []);
  return {
    ...defaultsForCode(code),
    message: err.message,
    provider_error: { status, payload },
  };
};
