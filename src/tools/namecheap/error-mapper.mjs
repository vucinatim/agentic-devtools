/**
 * Map NamecheapApiError → structured fail() args.
 *
 * Namecheap is XML-based with their own error codes. Most operational failures
 * are not HTTP status driven — they come back as 200 with an `<Errors>` block.
 * The NamecheapApiError class normalises that into `.errors[]` and may carry
 * a `.response.status` HTTP code for transport-level failures.
 */

import {
  ERROR_CODES,
  REMEDIATION_KINDS,
  defaultsForCode,
  mapHttpStatusToCode,
} from "../../core/result.mjs";

const DASHBOARD_URL =
  "https://ap.www.namecheap.com/Profile/Tools/ApiAccess";

// Namecheap-specific error-code prefixes / phrases that signal which
// remediation kind the user should follow. These match Namecheap's public
// error catalog (https://www.namecheap.com/support/api/error-codes/).
const isAuthError = (errors) =>
  errors.some((e) => {
    const num = Number(e?.Number ?? e?.number ?? 0);
    const text = String(e?.message ?? e?._ ?? "").toLowerCase();
    return (
      num === 1010101 || // API Key is invalid
      num === 1011150 || // ApiUser is invalid
      num === 1019103 || // IP not allowed (whitelist)
      text.includes("api key") ||
      text.includes("ip ") ||
      text.includes("whitelist")
    );
  });

const isIpAllowlistError = (errors) =>
  errors.some((e) => {
    const num = Number(e?.Number ?? e?.number ?? 0);
    const text = String(e?.message ?? e?._ ?? "").toLowerCase();
    return num === 1019103 || (text.includes("ip") && text.includes("allow"));
  });

export const mapNamecheapError = (err) => {
  if (!err || err.name !== "NamecheapApiError") {
    return null;
  }

  const errors = Array.isArray(err.errors) ? err.errors : [];
  const httpStatus = err?.response?.status ?? null;

  // Pre-flight (constructor argument errors before any network call).
  if (httpStatus === null && errors.length === 0) {
    const message = err.message ?? "Namecheap request failed";
    if (/missing/i.test(message) && /(api[_ ]?(user|key)|username|client[_ ]?ip)/i.test(message)) {
      return {
        code: ERROR_CODES.AUTH_EXPIRED,
        message,
        why: "Namecheap credentials are not configured.",
        remediation: {
          kind: REMEDIATION_KINDS.RECONNECT,
          url: DASHBOARD_URL,
          instructions:
            "Run `agentic-devtools connect namecheap`, or set NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, NAMECHEAP_CLIENT_IP.",
        },
        retriable: false,
      };
    }
    return {
      code: ERROR_CODES.VALIDATION_ERROR,
      message,
      remediation: {
        kind: REMEDIATION_KINDS.CODE_CHANGE,
        instructions: "Check the tool arguments — a required value was missing or invalid.",
      },
      retriable: false,
    };
  }

  // Transport-level (5xx, network)
  if (httpStatus >= 500) {
    const base = defaultsForCode(ERROR_CODES.TRANSIENT);
    return {
      ...base,
      message: err.message,
      provider_error: { status: httpStatus, errors },
    };
  }

  // Auth-like errors from Namecheap's XML error block
  if (isIpAllowlistError(errors)) {
    return {
      ...defaultsForCode(ERROR_CODES.PERMISSION_DENIED),
      message: err.message,
      why: "Your outbound IP is not on Namecheap's API allowlist.",
      remediation: {
        kind: REMEDIATION_KINDS.DASHBOARD,
        url: DASHBOARD_URL,
        instructions:
          "Open the Namecheap API Access page and add your machine's current outbound IP to the allowlist, then retry. Namecheap does not allow programmatic allowlist edits.",
      },
      provider_error: { status: httpStatus, errors },
    };
  }

  if (isAuthError(errors)) {
    return {
      ...defaultsForCode(ERROR_CODES.AUTH_EXPIRED),
      message: err.message,
      why: "Namecheap rejected the API user or key.",
      remediation: {
        kind: REMEDIATION_KINDS.RECONNECT,
        url: DASHBOARD_URL,
        instructions:
          "Re-run `agentic-devtools connect namecheap` and verify the API user, key, and whitelisted IP.",
      },
      provider_error: { status: httpStatus, errors },
    };
  }

  // Fall back to HTTP status mapping for any remaining transport-encoded
  // errors. Default to UNKNOWN with the raw payload attached.
  const code = httpStatus
    ? mapHttpStatusToCode(httpStatus, errors)
    : ERROR_CODES.UNKNOWN;
  return {
    ...defaultsForCode(code),
    message: err.message,
    provider_error: { status: httpStatus, errors },
  };
};
