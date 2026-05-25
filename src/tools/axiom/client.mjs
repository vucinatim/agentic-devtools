import {
  DEFAULT_AXIOM_API_BASE_URL,
  getAxiomAuthStatus,
  resolveAxiomAuthConfig,
} from "./auth.mjs";

export {
  DEFAULT_AXIOM_API_BASE_URL,
  getAxiomAuthStatus,
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

