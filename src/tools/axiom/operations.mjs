// Axiom operation registry — the single source of truth for Axiom's data
// operations, consumed by BOTH surfaces:
//   - mcp.mjs        registers each as an MCP tool (by `mcpName`)
//   - cli.mjs        dispatches each from argv (by `cliName`)
//
// Each handler takes `(args, { client })` — the client is injected by the
// frontend (created once per MCP server / once per CLI invocation). Both
// frontends wrap handlers with `wrapToolHandler(handler, { mapError })`, so
// the structured-error contract is identical across MCP and CLI.
//
// Auth/diagnostic ops (connect, auth-status, disconnect, test-connection) are
// NOT here — they have dedicated cross-provider CLI subcommands and are
// registered separately in mcp.mjs.
//
// `parseArgs(options)` maps CLI flags → the handler's args object. Complex
// array/object args (charts, layout) are best passed via `--json '{...}'`,
// which the CLI runner always honors and which takes precedence over parseArgs.

import { z } from "zod";
import {
  getIntegerOption,
  getStringOption,
} from "../../core/cli-runner.mjs";

export const axiomOperations = [
  // -- Discovery ------------------------------------------------------------
  {
    cliName: "list-datasets",
    mcpName: "listAxiomDatasets",
    description:
      "List the Axiom datasets visible to this token. USE THIS first when you don't know the dataset name to query.",
    handler: (_args, { client }) => client.listDatasets(),
    parseArgs: () => ({}),
  },
  {
    cliName: "get-dataset",
    mcpName: "getAxiomDataset",
    description:
      "Get one Axiom dataset's metadata (description, retention, who created it, etc.).",
    inputSchema: { name: z.string().min(1) },
    handler: (args, { client }) => client.getDataset(args),
    parseArgs: (o) => ({ name: getStringOption(o, "name") }),
  },

  // -- Query ----------------------------------------------------------------
  {
    cliName: "query",
    mcpName: "queryAxiom",
    description:
      "Run an APL query against Axiom. Returns rows (matches array) and metadata. APL syntax: dataset is referenced in the query itself, e.g. `['my-app-prod'] | where userId == 'X' | order by _time desc | limit 50`. Time range optional via startTime/endTime (ISO strings or relative shorthand like '1h', '30m', '7d').",
    inputSchema: {
      apl: z.string().min(1),
      startTime: z.string().optional(),
      endTime: z.string().optional(),
    },
    handler: (args, { client }) => client.query(args),
    parseArgs: (o) => ({
      apl: getStringOption(o, "apl"),
      startTime: getStringOption(o, "start-time") ?? undefined,
      endTime: getStringOption(o, "end-time") ?? undefined,
    }),
  },
  {
    cliName: "recent-errors",
    mcpName: "axiomRecentErrors",
    description:
      "Convenience: query the most recent error-level events in a dataset (last N hours). USE THIS to answer 'what's broken in production?' without writing APL.",
    inputSchema: {
      dataset: z.string().min(1).optional(),
      window: z.string().optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    },
    handler: (args, { client }) => client.recentErrors(args),
    parseArgs: (o) => ({
      dataset: getStringOption(o, "dataset") ?? undefined,
      window: getStringOption(o, "window") ?? undefined,
      limit: getIntegerOption(o, "limit"),
    }),
  },
  {
    cliName: "get-trace",
    mcpName: "axiomGetTraceById",
    description:
      "Convenience: fetch all events for one traceId across the last 7 days. USE THIS to debug a specific request when you know the trace id.",
    inputSchema: {
      traceId: z.string().min(1),
      dataset: z.string().min(1).optional(),
    },
    handler: (args, { client }) => client.getTraceById(args),
    parseArgs: (o) => ({
      traceId: getStringOption(o, "trace-id"),
      dataset: getStringOption(o, "dataset") ?? undefined,
    }),
  },

  // -- Dashboards -----------------------------------------------------------
  {
    cliName: "list-dashboards",
    mcpName: "axiomListDashboards",
    description:
      "List all Axiom dashboards visible to this token. Each item includes id, uid (custom), name, and version. Use first when looking for an existing dashboard.",
    handler: (_args, { client }) => client.listDashboards(),
    parseArgs: () => ({}),
  },
  {
    cliName: "get-dashboard",
    mcpName: "axiomGetDashboard",
    description:
      "Fetch one dashboard's full contents by uid. Axiom's single-dashboard endpoints key on uid (the stable user-set or auto-generated identifier), NOT the internal `id` returned in list responses. Response includes the dashboard body AND a `version` integer — pass that version to axiomUpdateDashboard / axiomAddChart / axiomUpdateChart / axiomRemoveChart to avoid lost-update races.",
    inputSchema: { uid: z.string().min(1) },
    handler: (args, { client }) => client.getDashboard(args),
    parseArgs: (o) => ({ uid: getStringOption(o, "uid") }),
  },
  {
    cliName: "find-dashboard",
    mcpName: "axiomFindDashboardByUid",
    description:
      "Look up a dashboard by its custom `uid` field. Returns null when not found (does not throw). Use this for idempotent provisioning: call before axiomCreateDashboard so you don't create duplicates. The zeroframe default dashboard uses uid `zero-frame-<project-slug>`.",
    inputSchema: { uid: z.string().min(1) },
    handler: (args, { client }) => client.findDashboardByUid(args),
    parseArgs: (o) => ({ uid: getStringOption(o, "uid") }),
  },
  {
    cliName: "create-dashboard",
    mcpName: "axiomCreateDashboard",
    description:
      'Create a new Axiom dashboard. Minimal usage: pass `name`. To make the dashboard idempotently findable, also pass `uid` (string, e.g. "zero-frame-myapp"). To pre-populate panels, pass `charts[]` (each: { id, type, name, query, ...}) and matching `layout[]` (each: { i: chart.id, x, y, w, h }). Sensible defaults for owner, schemaVersion, refreshTime, timeWindow* are filled in if omitted. Chart types: TimeSeries, Heatmap, LogStream, Pie, Scatter, Table, TopK, Statistic, Note, MonitorList, SmartFilter, Spacer. For charts/layout via CLI, use --json.',
    inputSchema: {
      name: z.string().min(1).max(100),
      uid: z.string().min(1).max(128).optional(),
      description: z.string().max(1000).optional(),
      charts: z.array(z.any()).optional(),
      layout: z.array(z.any()).optional(),
      refreshTime: z.number().optional(),
      timeWindowStart: z.string().optional(),
      timeWindowEnd: z.string().optional(),
    },
    handler: (args, { client }) => client.createDashboard(args),
    parseArgs: (o) => ({
      name: getStringOption(o, "name"),
      uid: getStringOption(o, "uid") ?? undefined,
      description: getStringOption(o, "description") ?? undefined,
    }),
  },
  {
    cliName: "update-dashboard",
    mcpName: "axiomUpdateDashboard",
    description:
      "Replace a dashboard's contents wholesale. Requires `uid` and `version` (from a prior get — Axiom enforces optimistic concurrency). For incremental panel edits PREFER the granular tools (axiomAddChart, axiomUpdateChart, axiomRemoveChart) — they handle the version dance for you. Pass `overwrite: true` to skip the version check (last-write-wins). For charts/layout via CLI, use --json.",
    inputSchema: {
      uid: z.string().min(1),
      version: z.number().int().optional(),
      overwrite: z.boolean().optional(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(1000).optional(),
      charts: z.array(z.any()).optional(),
      layout: z.array(z.any()).optional(),
      refreshTime: z.number().optional(),
      timeWindowStart: z.string().optional(),
      timeWindowEnd: z.string().optional(),
    },
    handler: (args, { client }) => client.updateDashboard(args),
    parseArgs: (o) => ({
      uid: getStringOption(o, "uid"),
      name: getStringOption(o, "name") ?? undefined,
      description: getStringOption(o, "description") ?? undefined,
    }),
  },
  {
    cliName: "delete-dashboard",
    mcpName: "axiomDeleteDashboard",
    description:
      "Permanently delete a dashboard by uid. USE THIS only when the user explicitly asks — there is no undo.",
    inputSchema: { uid: z.string().min(1) },
    handler: (args, { client }) => client.deleteDashboard(args),
    parseArgs: (o) => ({ uid: getStringOption(o, "uid") }),
  },
  {
    cliName: "add-chart",
    mcpName: "axiomAddChart",
    description:
      'Append a chart (panel) to an existing dashboard. Reads the current dashboard, appends the chart and a layout entry, writes the dashboard back atomically (using the current version). USE THIS when the user asks to add a panel like "show me failed logins by hour". Layout is auto-generated (full-width, stacked below existing) if not provided. CLI: pass the chart via --json.',
    inputSchema: {
      dashboardUid: z.string().min(1),
      chart: z.object({
        id: z.string().min(1).max(200),
        type: z.string().min(1),
        name: z.string().optional(),
        query: z.any().optional(),
        tableSettings: z.any().optional(),
        text: z.string().optional(),
      }),
      layout: z
        .object({
          i: z.string(),
          x: z.number().int().min(0).max(11),
          y: z.number().int().min(0),
          w: z.number().int().min(1).max(12),
          h: z.number().min(1),
        })
        .optional(),
    },
    handler: (args, { client }) => client.addChart(args),
    // chart is a nested object — CLI usage is --json. parseArgs only resolves
    // the dashboard selector so `--dashboard-uid X --json '{"chart":{...}}'`
    // would still work if someone mixes, but --json wins wholesale anyway.
    parseArgs: (o) => ({ dashboardUid: getStringOption(o, "dashboard-uid") }),
  },
  {
    cliName: "update-chart",
    mcpName: "axiomUpdateChart",
    description:
      "Patch one chart in a dashboard by its chart id. Merges the partial fields into the existing chart, leaves all other charts untouched. USE THIS when the user asks to retitle/rescope/retype a specific panel without disturbing the rest. CLI: pass field updates via --json.",
    inputSchema: {
      dashboardUid: z.string().min(1),
      chartId: z.string().min(1),
      name: z.string().optional(),
      type: z.string().optional(),
      query: z.any().optional(),
      tableSettings: z.any().optional(),
      text: z.string().optional(),
    },
    handler: (args, { client }) => client.updateChart(args),
    parseArgs: (o) => ({
      dashboardUid: getStringOption(o, "dashboard-uid"),
      chartId: getStringOption(o, "chart-id"),
      name: getStringOption(o, "name") ?? undefined,
      type: getStringOption(o, "type") ?? undefined,
    }),
  },
  {
    cliName: "remove-chart",
    mcpName: "axiomRemoveChart",
    description:
      "Remove one chart (and its layout entry) from a dashboard. No-op if the chart id isn't present. USE THIS when the user asks to drop a specific panel.",
    inputSchema: {
      dashboardUid: z.string().min(1),
      chartId: z.string().min(1),
    },
    handler: (args, { client }) => client.removeChart(args),
    parseArgs: (o) => ({
      dashboardUid: getStringOption(o, "dashboard-uid"),
      chartId: getStringOption(o, "chart-id"),
    }),
  },
];
