import {
  DEFAULT_AXIOM_API_BASE_URL,
  getAxiomAuthStatus,
  getAxiomBootstrapToken,
  resolveAxiomAuthConfig,
} from "./auth.mjs";

export {
  DEFAULT_AXIOM_API_BASE_URL,
  getAxiomAuthStatus,
  getAxiomBootstrapToken,
  resolveAxiomAuthConfig,
} from "./auth.mjs";

export class AxiomApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "AxiomApiError";
    this.details = details;
  }
}

/**
 * Convenience: convert "5 minutes ago" / "1h" style strings to ISO timestamps.
 * Accepts: ISO strings (passthrough), unix ms (number), or relative shorthand
 * like "1h", "30m", "2d". Returns ISO 8601.
 */
const RELATIVE_RE = /^(\d+)(s|m|h|d)$/;
const UNIT_TO_MS = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export const toIsoTimestamp = (value, { now = Date.now } = {}) => {
  if (value == null) return null;
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  const str = String(value).trim();
  if (!str) return null;
  // Relative shorthand?
  const m = RELATIVE_RE.exec(str);
  if (m) {
    const amount = Number.parseInt(m[1], 10);
    const ms = amount * (UNIT_TO_MS[m[2]] ?? 0);
    return new Date(now() - ms).toISOString();
  }
  // Assume ISO. Pass through (don't bother round-tripping a Date).
  return str;
};

export const createAxiomClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const auth = resolveAxiomAuthConfig(env);
  const status = getAxiomAuthStatus(env);
  const apiBaseUrl =
    status.apiBaseUrl?.replace(/\/+$/, "") || DEFAULT_AXIOM_API_BASE_URL;

  if (typeof fetchImpl !== "function") {
    throw new Error("Axiom client requires a fetch implementation.");
  }

  const request = async (
    method,
    pathname,
    { body, query, headers } = {},
  ) => {
    if (!auth.token) {
      throw new AxiomApiError(
        "Missing Axiom API token. Run `agentic-devtools connect axiom`, or set AXIOM_TOKEN.",
      );
    }

    const url = new URL(pathname.replace(/^\//, ""), `${apiBaseUrl}/`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }

    const init = {
      method,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...(headers ?? {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const response = await fetchImpl(url, init);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      throw new AxiomApiError(
        formatAxiomErrorMessage(payload, response.status),
        {
          status: response.status,
          payload,
        },
      );
    }
    return payload;
  };

  /**
   * List the datasets visible to this token.
   * GET /v1/datasets
   */
  const listDatasets = async () => {
    const result = await request("GET", "/v1/datasets");
    const datasets = Array.isArray(result) ? result : (result?.datasets ?? []);
    return { datasets };
  };

  /**
   * Get one dataset's metadata (size, retention, who-created, etc.).
   * GET /v1/datasets/{name}
   */
  const getDataset = async ({ name } = {}) => {
    if (!name) {
      throw new AxiomApiError("getDataset requires { name }.");
    }
    const result = await request("GET", `/v1/datasets/${encodeURIComponent(name)}`);
    return result;
  };

  /**
   * Run an APL query against Axiom. Returns the rows + metadata.
   * POST /v1/datasets/_apl
   *
   * Axiom's APL accepts the dataset name inside the query string itself
   * (e.g. `['my-app'] | where userId == 'X'`), so this method doesn't take a
   * separate dataset arg — the caller embeds it.
   *
   * Time-range can be specified via startTime/endTime (ISO strings or
   * relative shorthand like "1h"). If omitted, Axiom uses its default
   * (typically last 15 min).
   */
  const query = async ({ apl, startTime, endTime } = {}) => {
    if (!apl || typeof apl !== "string") {
      throw new AxiomApiError(
        "axiom.query requires { apl: '<APL query string>' }.",
      );
    }
    const body = {
      apl,
      ...(startTime ? { startTime: toIsoTimestamp(startTime) } : {}),
      ...(endTime ? { endTime: toIsoTimestamp(endTime) } : {}),
    };
    const result = await request("POST", "/v1/datasets/_apl", { body });
    // Axiom's APL response shape:
    //   { tables: [{ name, sources, fields, columns, range }], matches?: [...]
    //     status: { elapsedTime, ... }, request: { ... } }
    // For agent convenience, surface a flat `rows` array when possible.
    const matches = Array.isArray(result?.matches) ? result.matches : null;
    return {
      matches: matches ?? [],
      tables: result?.tables ?? [],
      status: result?.status ?? null,
      raw: result,
    };
  };

  /**
   * Convenience: query for recent error-level events in a dataset.
   * Defaults: last 1h, levels = ['error', 'fatal', '50'] (Pino uses numeric levels).
   */
  const recentErrors = async ({
    dataset,
    window = "1h",
    limit = 100,
  } = {}) => {
    const resolvedDataset = dataset ?? auth.defaultDataset;
    if (!resolvedDataset) {
      throw new AxiomApiError(
        "axiom.recentErrors requires { dataset } or AXIOM_DATASET env / default dataset in config.",
      );
    }
    // APL: match anything with level >= warn OR an explicit error field.
    // Pino's numeric levels: warn=40, error=50, fatal=60.
    const apl = `['${resolvedDataset.replace(/'/g, "\\'")}']
| where (
    (isnotnull(level) and tolong(level) >= 40)
    or (isnotnull(['attributes.http.status_code']) and toint(['attributes.http.status_code']) >= 500)
    or isnotempty(['attributes.error.message'])
  )
| order by _time desc
| limit ${Math.max(1, Math.min(1000, Number.parseInt(String(limit), 10) || 100))}`;
    return query({
      apl,
      startTime: window,
    });
  };

  /**
   * Convenience: fetch all events for one traceId.
   */
  const getTraceById = async ({ dataset, traceId } = {}) => {
    if (!traceId) {
      throw new AxiomApiError("axiom.getTraceById requires { traceId }.");
    }
    const resolvedDataset = dataset ?? auth.defaultDataset;
    if (!resolvedDataset) {
      throw new AxiomApiError(
        "axiom.getTraceById requires { dataset } or a default dataset.",
      );
    }
    const apl = `['${resolvedDataset.replace(/'/g, "\\'")}']
| where ['trace_id'] == '${traceId.replace(/'/g, "")}' or traceId == '${traceId.replace(/'/g, "")}'
| order by _time asc`;
    return query({ apl, startTime: "7d" });
  };

  /**
   * Validate the token by listing datasets. Used by `test-connection`.
   */
  const validateToken = async () => {
    const { datasets } = await listDatasets();
    return {
      ok: true,
      datasetCount: datasets.length,
      sampleDatasets: datasets.slice(0, 5).map((d) => ({
        name: d.name ?? d.id ?? null,
      })),
    };
  };

  return {
    auth,
    apiBaseUrl,
    getAuthStatus: () => getAxiomAuthStatus(env),
    validateToken,
    listDatasets,
    getDataset,
    query,
    recentErrors,
    getTraceById,
  };
};

const formatAxiomErrorMessage = (payload, status) => {
  if (payload && typeof payload === "object") {
    const msg =
      pickFirstString(
        payload.message,
        payload.error,
        payload.detail,
        payload.errors?.[0]?.message,
      ) ?? null;
    if (msg) return msg;
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim();
  }
  return `Axiom API request failed with HTTP ${status}`;
};

const pickFirstString = (...values) => {
  for (const v of values) {
    if (typeof v === "string" && v.trim().length > 0) {
      return v.trim();
    }
  }
  return null;
};

// =============================================================================
// Bootstrap client — used only at project-init time
// =============================================================================
//
// Mirrors the Cloudflare bootstrap pattern. The bootstrap is a narrow Axiom
// token whose ONLY capability is creating other tokens (orgCapabilities.apiTokens).
// It uses POST /v2/tokens to mint scoped working tokens for individual projects:
// each working token gets Query-only access on the specific dataset(s) the
// project uses, nothing more.
//
// Workflow:
//   1. User runs `bun zero connect axiom` once per machine. Browser-based
//      flow walks them through creating the narrow bootstrap in Axiom's UI
//      and pastes it. Saved to ~/.config/agentic-devtools/axiom-bootstrap.json.
//   2. When connecting Axiom for a project, the bootstrap client:
//        a. Lists available datasets (GET /v1/datasets — works with any token)
//        b. Asks user which dataset(s) this project uses
//        c. Mints a Query-only working token scoped to those datasets
//        d. Working token is written to .zeroframe/credentials/axiom.json
//   3. After that, only the working token is used.

export const createAxiomBootstrapClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const bootstrap = getAxiomBootstrapToken(env);
  // Use `||` not `??`: stored config writes apiBaseUrl: "" (empty string) when
  // the user accepts the default. `??` only falls back on null/undefined, so
  // an empty string would slip through and produce `new URL("v1/datasets", "/")`.
  const apiBaseUrl = (
    bootstrap.apiBaseUrl?.trim() || DEFAULT_AXIOM_API_BASE_URL
  ).replace(/\/+$/, "");

  if (typeof fetchImpl !== "function") {
    throw new Error("Axiom bootstrap client requires a fetch implementation.");
  }

  const request = async (method, pathname, { body } = {}) => {
    if (!bootstrap.token) {
      throw new AxiomApiError(
        "Missing Axiom bootstrap token. Run `bun zero connect axiom` once per machine to create one.",
      );
    }
    const url = new URL(pathname.replace(/^\//, ""), `${apiBaseUrl}/`);
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.token}`,
        ...(bootstrap.orgId ? { "x-axiom-org-id": bootstrap.orgId } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetchImpl(url, init);
    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }
    if (!response.ok) {
      throw new AxiomApiError(
        formatAxiomErrorMessage(payload, response.status),
        { status: response.status, payload },
      );
    }
    return payload;
  };

  /**
   * Verify the bootstrap token has the right shape (can list tokens —
   * proxy for "has apiTokens capability").
   */
  const validate = async () => {
    const result = await request("GET", "/v2/tokens");
    const tokens = Array.isArray(result)
      ? result
      : Array.isArray(result?.tokens)
        ? result.tokens
        : [];
    return {
      ok: true,
      tokenCount: tokens.length,
      source: bootstrap.source,
    };
  };

  /**
   * List the datasets visible to this bootstrap. Note: a narrow bootstrap
   * (only apiTokens) may NOT see datasets — in that case it'll 403. The
   * connect orchestrator handles that case by asking the user to type
   * the dataset name(s) manually.
   */
  const listAccessibleDatasets = async () => {
    try {
      const result = await request("GET", "/v1/datasets");
      const datasets = Array.isArray(result) ? result : (result?.datasets ?? []);
      return { datasets, accessible: true };
    } catch (err) {
      if (err?.details?.status === 403) {
        // Bootstrap is correctly narrow — it can mint but not query.
        // Surface that explicitly so the orchestrator can prompt for
        // dataset names instead.
        return { datasets: [], accessible: false, narrowBootstrap: true };
      }
      throw err;
    }
  };

  /**
   * Mint a scoped working token via POST /v2/tokens.
   *
   * Defaults to Query-only on the supplied datasets. Override via
   * `datasetCapabilities` for advanced cases (e.g. mint a token that also
   * ingests). Returns { tokenValue, tokenId, name, datasetCapabilities }.
   *
   * The token value is ONLY returned on creation — the caller must persist
   * it immediately.
   */
  const mintWorkingToken = async ({
    name,
    datasets = [],
    datasetCapabilities,
    orgCapabilities = {},
    expiresAt = null,
    description = "",
  } = {}) => {
    if (!name) {
      throw new AxiomApiError(
        "mintWorkingToken requires { name } for the new token.",
      );
    }

    // Build datasetCapabilities from `datasets` shortcut if not explicit.
    let resolvedDatasetCaps;
    if (datasetCapabilities && typeof datasetCapabilities === "object") {
      resolvedDatasetCaps = datasetCapabilities;
    } else {
      if (!Array.isArray(datasets) || datasets.length === 0) {
        throw new AxiomApiError(
          "mintWorkingToken requires either { datasetCapabilities } or { datasets: [...] }.",
        );
      }
      resolvedDatasetCaps = {};
      for (const ds of datasets) {
        resolvedDatasetCaps[ds] = { query: ["read"] };
      }
    }

    const body = {
      name,
      ...(description ? { description } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      datasetCapabilities: resolvedDatasetCaps,
      orgCapabilities,
    };

    const result = await request("POST", "/v2/tokens", { body });

    // Axiom returns the token on creation only.
    const tokenValue = result?.token;
    if (!tokenValue || typeof tokenValue !== "string") {
      throw new AxiomApiError(
        "Axiom did not return a token value on /v2/tokens creation.",
        { payload: result },
      );
    }

    return {
      tokenId: result.id ?? null,
      tokenValue,
      name: result.name ?? name,
      datasetCapabilities: result.datasetCapabilities ?? resolvedDatasetCaps,
      orgCapabilities: result.orgCapabilities ?? orgCapabilities,
      expiresAt: result.expiresAt ?? expiresAt,
    };
  };

  return {
    bootstrap,
    apiBaseUrl,
    validate,
    listAccessibleDatasets,
    mintWorkingToken,
  };
};
