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
    // Axiom requires the `format` query parameter on /v1/datasets/_apl:
    //   - "legacy"  → response includes top-level `matches` array (what we want)
    //   - "tabular" → response is a tabular `tables[]` shape; matches absent
    // We default to "legacy" so callers get rows in the shape this method
    // documents.
    const result = await request("POST", "/v1/datasets/_apl", {
      body,
      query: { format: "legacy" },
    });
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

  // -- Dashboards ---------------------------------------------------------
  //
  // Axiom's POST /v2/dashboards expects the dashboard JSON wrapped in a
  // `{ dashboard: {...} }` envelope, plus `overwrite` and `version` controls
  // for optimistic concurrency. All single-dashboard operations key on `uid`
  // (a stable user-set or auto-generated identifier), via the path
  // `/v2/dashboards/uid/{uid}` — NOT the internal `id` field despite what
  // the public docs imply.
  //
  // Version handling has a JS-specific wrinkle: Axiom serializes `version`
  // as int64 (numbers like 1779730400809849898) which exceed JS Number's
  // 2^53 safe range. Standard JSON.parse silently rounds, so we can't
  // round-trip the exact version back to PUT (Axiom rejects with "version
  // mismatch"). Two consequences:
  //
  //  - updateDashboard() callers who care about optimistic concurrency
  //    MUST construct the version as a BigInt and serialize separately, OR
  //    use `overwrite: true` to skip the check.
  //  - The granular helpers (addChart / updateChart / removeChart) default
  //    to `overwrite: true` — single-agent dashboard edits don't need
  //    concurrency control, and the tradeoff (last-write-wins if two agents
  //    race) is acceptable. If/when we add multi-agent dashboard editing
  //    we'll swap these to a BigInt-preserving JSON path or use Axiom's
  //    PATCH endpoint (single-chart, version-aware).

  /**
   * Wrap a dashboard payload in the API's expected envelope. `overwrite`
   * defaults false; `version` is required on updates (when known).
   */
  const wrapDashboardEnvelope = (dashboard, { version, overwrite } = {}) => {
    const body = { dashboard };
    if (version !== undefined) body.version = version;
    if (overwrite) body.overwrite = true;
    return body;
  };

  /**
   * Create a new dashboard. Required: `name`, `owner` (use the constant
   * `"X-AXIOM-EVERYONE"` for org-wide access). Optional but recommended:
   * `description`, `charts[]`, `layout[]`, `uid` (for stable lookup).
   *
   * Axiom requires `schemaVersion: 2`, `timeWindowStart`, `timeWindowEnd`,
   * `refreshTime` — we fill in sensible defaults if omitted so callers
   * only have to supply meaningful fields.
   */
  const createDashboard = async (dashboard = {}) => {
    if (!dashboard.name) {
      throw new AxiomApiError("createDashboard requires { name }.");
    }
    const body = wrapDashboardEnvelope({
      owner: "X-AXIOM-EVERYONE",
      schemaVersion: 2,
      refreshTime: 60,
      timeWindowStart: "qr-now-1h",
      timeWindowEnd: "qr-now",
      charts: [],
      layout: [],
      ...dashboard,
    });
    return request("POST", "/v2/dashboards", { body });
  };

  /** List all dashboards visible to this token. */
  const listDashboards = async () => {
    const result = await request("GET", "/v2/dashboards");
    const dashboards = Array.isArray(result) ? result : (result?.dashboards ?? []);
    return { dashboards };
  };

  /**
   * Fetch one dashboard by its `uid`. Axiom's single-dashboard endpoints all
   * key on `uid` — NOT the auto-assigned `id` field, despite what the public
   * docs imply. POST returns both fields; downstream calls (get/update/
   * delete/patch) must use `uid`.
   *
   * Accepts `uid` (preferred) OR `id` (treated as uid alias for ergonomics).
   * Response includes the dashboard payload, a `version` integer (required
   * for safe updates), and metadata.
   */
  const getDashboard = async ({ uid, id } = {}) => {
    const lookupUid = uid ?? id;
    if (!lookupUid) {
      throw new AxiomApiError("getDashboard requires { uid }.");
    }
    return request(
      "GET",
      `/v2/dashboards/uid/${encodeURIComponent(lookupUid)}`,
    );
  };

  /**
   * Find a dashboard by its custom `uid`, returning null when not found
   * rather than throwing. Issues a direct GET; swallows the 404.
   * Useful for idempotent provisioning flows ("does my dashboard exist yet?").
   */
  const findDashboardByUid = async ({ uid } = {}) => {
    if (!uid) {
      throw new AxiomApiError("findDashboardByUid requires { uid }.");
    }
    try {
      return await getDashboard({ uid });
    } catch (error) {
      if (
        error instanceof AxiomApiError &&
        (error.details?.status === 404 ||
          /not found/i.test(error.message ?? ""))
      ) {
        return null;
      }
      throw error;
    }
  };

  /**
   * Replace a dashboard's contents. Caller supplies the full new dashboard
   * payload + the `version` they received from a prior GET. Returns the new
   * version. Pass `overwrite: true` to bypass version-check (last-write-wins).
   *
   * Accepts `uid` (preferred) OR `id` (treated as uid alias for ergonomics).
   */
  const updateDashboard = async ({
    uid,
    id,
    version,
    overwrite = false,
    ...dashboard
  } = {}) => {
    const lookupUid = uid ?? id;
    if (!lookupUid) {
      throw new AxiomApiError("updateDashboard requires { uid }.");
    }
    if (!overwrite && version === undefined) {
      throw new AxiomApiError(
        "updateDashboard requires { version } from a prior GET (or pass overwrite: true to skip the check).",
      );
    }
    const body = wrapDashboardEnvelope(
      { schemaVersion: 2, ...dashboard },
      { version, overwrite },
    );
    return request(
      "PUT",
      `/v2/dashboards/uid/${encodeURIComponent(lookupUid)}`,
      { body },
    );
  };

  /**
   * Delete a dashboard by uid.
   * Accepts `uid` (preferred) OR `id` (treated as uid alias for ergonomics).
   */
  const deleteDashboard = async ({ uid, id } = {}) => {
    const lookupUid = uid ?? id;
    if (!lookupUid) {
      throw new AxiomApiError("deleteDashboard requires { uid }.");
    }
    await request(
      "DELETE",
      `/v2/dashboards/uid/${encodeURIComponent(lookupUid)}`,
    );
    return { uid: lookupUid, deleted: true };
  };

  /**
   * Append a chart to an existing dashboard. Reads current dashboard, appends
   * the chart (and its layout entry) to the arrays, writes the dashboard
   * back with the current version. Returns the new version.
   *
   * Layout: if `layout` is omitted, we generate a sensible default — full
   * width, 4 rows tall, stacked under the existing charts.
   */
  const addChart = async ({ dashboardUid, dashboardId, chart, layout } = {}) => {
    const lookupUid = dashboardUid ?? dashboardId;
    if (!lookupUid) {
      throw new AxiomApiError("addChart requires { dashboardUid }.");
    }
    if (!chart || !chart.id || !chart.type) {
      throw new AxiomApiError("addChart requires { chart: { id, type, ... } }.");
    }
    const current = await getDashboard({ uid: lookupUid });
    // Axiom serializes `version` as a STRING inside nested `dashboard.version`
    // but as a NUMBER (int64) at the top level — and the API requires the
    // numeric form on PUT. We strip the nested string version when spreading
    // to avoid clobbering our top-level numeric one.
    const { version: _nestedVersion, ...dashboard } = current?.dashboard ?? {};
    const charts = [...(dashboard.charts ?? []), chart];
    const existingLayout = dashboard.layout ?? [];
    const nextY = existingLayout.reduce(
      (max, l) => Math.max(max, (l.y ?? 0) + (l.h ?? 0)),
      0,
    );
    const newLayout = [
      ...existingLayout,
      layout ?? { i: chart.id, x: 0, y: nextY, w: 12, h: 4 },
    ];
    return updateDashboard({
      uid: lookupUid,
      overwrite: true,
      ...dashboard,
      charts,
      layout: newLayout,
    });
  };

  /**
   * Patch a single chart in a dashboard by chart id. `partial` is merged on
   * top of the existing chart. Reads current dashboard, mutates the matching
   * chart, writes back.
   */
  const updateChart = async ({
    dashboardUid,
    dashboardId,
    chartId,
    ...partial
  } = {}) => {
    const lookupUid = dashboardUid ?? dashboardId;
    if (!lookupUid || !chartId) {
      throw new AxiomApiError(
        "updateChart requires { dashboardUid, chartId, ...partial }.",
      );
    }
    const current = await getDashboard({ uid: lookupUid });
    // See addChart for why we strip nested `version` (string vs number).
    const { version: _nestedVersion, ...dashboard } = current?.dashboard ?? {};
    const existingChart = (dashboard.charts ?? []).find((c) => c.id === chartId);
    if (!existingChart) {
      throw new AxiomApiError(
        `updateChart: no chart with id "${chartId}" in dashboard "${lookupUid}".`,
      );
    }
    const charts = (dashboard.charts ?? []).map((c) =>
      c.id === chartId ? { ...c, ...partial } : c,
    );
    return updateDashboard({
      uid: lookupUid,
      overwrite: true,
      ...dashboard,
      charts,
    });
  };

  /**
   * Remove a chart (and its layout entry) from a dashboard. No-op if the
   * chart id isn't present.
   */
  const removeChart = async ({ dashboardUid, dashboardId, chartId } = {}) => {
    const lookupUid = dashboardUid ?? dashboardId;
    if (!lookupUid || !chartId) {
      throw new AxiomApiError(
        "removeChart requires { dashboardUid, chartId }.",
      );
    }
    const current = await getDashboard({ uid: lookupUid });
    // See addChart for why we strip nested `version` (string vs number).
    const { version: _nestedVersion, ...dashboard } = current?.dashboard ?? {};
    const charts = (dashboard.charts ?? []).filter((c) => c.id !== chartId);
    const layout = (dashboard.layout ?? []).filter((l) => l.i !== chartId);
    return updateDashboard({
      uid: lookupUid,
      overwrite: true,
      ...dashboard,
      charts,
      layout,
    });
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
    // Dashboards
    createDashboard,
    listDashboards,
    getDashboard,
    findDashboardByUid,
    updateDashboard,
    deleteDashboard,
    addChart,
    updateChart,
    removeChart,
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

