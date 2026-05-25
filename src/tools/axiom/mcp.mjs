#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapToolHandler } from "../../core/result.mjs";
import {
  AXIOM_AUTH_CONFIG_PATH,
  disconnectAxiom,
  getAxiomAuthStatus,
  runAxiomBrowserAuthFlow,
} from "./auth.mjs";
import { createAxiomClient } from "./client.mjs";
import { mapAxiomError } from "./error-mapper.mjs";

const HELP_TEXT = `Usage: agentic-devtools mcp axiom

Axiom MCP server — query production logs/traces with APL.

Optional environment variables:
  AXIOM_TOKEN
  AXIOM_DATASET           default dataset for queries that omit one
  AXIOM_API_BASE_URL      override (default https://api.axiom.co)
  AXIOM_AUTH_CONFIG_PATH

Standalone flags:
  --connect
  --auth-status
  --test-connection

The agent's primary tools:
  axiom_query              — run an arbitrary APL query, returns rows
  axiom_recent_errors      — convenience: recent error-level events
  axiom_list_datasets      — discover datasets available to the token
  axiom_get_dataset        — inspect one dataset's schema/metadata
  axiom_get_trace_by_id    — pull all events for one traceId
  axiom_list_dashboards    — discover existing dashboards
  axiom_create_dashboard   — provision a dashboard (idempotent via uid)
  axiom_add_chart          — append a panel to an existing dashboard
  axiom_update_chart       — patch a single panel
  axiom_remove_chart       — drop a panel
`;

const createServer = () => {
  const server = new McpServer(
    {
      name: "axiom",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools to query production logs and OpenTelemetry traces in Axiom from chat. APL is the query language — see https://axiom.co/docs/apl. When debugging a user complaint, start with axiom_recent_errors or axiom_get_trace_by_id; for arbitrary investigation, axiom_query takes any APL. When a query fails with VALIDATION_ERROR, the `remediation` field tells you what's wrong (usually case-sensitive field names or unknown columns).",
    },
  );

  // Auto-wrap every handler in the structured-error middleware. Errors flow
  // through mapAxiomError → fail() with code + remediation.
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = (name, spec, handler) =>
    originalRegisterTool(
      name,
      spec,
      wrapToolHandler(handler, { mapError: mapAxiomError }),
    );

  const withClient = async (callback) => {
    const client = createAxiomClient();
    return callback(client);
  };

  // -- Auth + diagnostics ---------------------------------------------------

  server.registerTool(
    "getAxiomAuthStatus",
    {
      description:
        "Show whether Axiom credentials are configured (without exposing the token).",
    },
    async () => getAxiomAuthStatus(),
  );

  server.registerTool(
    "connectAxiom",
    {
      description:
        "Open a browser-based guided setup flow for an Axiom API token.",
    },
    async () => ({
      ...(await runAxiomBrowserAuthFlow()),
      configPath: AXIOM_AUTH_CONFIG_PATH,
    }),
  );

  server.registerTool(
    "disconnectAxiom",
    {
      description: "Remove the locally stored Axiom token.",
    },
    async () => disconnectAxiom(),
  );

  server.registerTool(
    "testAxiomConnection",
    {
      description:
        "Verify Axiom credentials by listing the datasets visible to the token.",
    },
    async () =>
      withClient(async (client) => {
        const validation = await client.validateToken();
        return {
          ok: validation.ok,
          tokenSource: client.auth.source,
          defaultDataset: client.auth.defaultDataset,
          validation,
        };
      }),
  );

  // -- Discovery ------------------------------------------------------------

  server.registerTool(
    "listAxiomDatasets",
    {
      description:
        "List the Axiom datasets visible to this token. USE THIS first when you don't know the dataset name to query.",
    },
    async () => withClient((client) => client.listDatasets()),
  );

  server.registerTool(
    "getAxiomDataset",
    {
      description:
        "Get one Axiom dataset's metadata (description, retention, who created it, etc.).",
      inputSchema: {
        name: z.string().min(1),
      },
    },
    async (args) => withClient((client) => client.getDataset(args)),
  );

  // -- Query ----------------------------------------------------------------

  server.registerTool(
    "queryAxiom",
    {
      description:
        "Run an APL query against Axiom. Returns rows (matches array) and metadata. APL syntax: dataset is referenced in the query itself, e.g. `['my-app-prod'] | where userId == 'X' | order by _time desc | limit 50`. Time range optional via startTime/endTime (ISO strings or relative shorthand like '1h', '30m', '7d').",
      inputSchema: {
        apl: z.string().min(1),
        startTime: z.string().optional(),
        endTime: z.string().optional(),
      },
    },
    async (args) => withClient((client) => client.query(args)),
  );

  server.registerTool(
    "axiomRecentErrors",
    {
      description:
        "Convenience: query the most recent error-level events in a dataset (last N hours). USE THIS to answer 'what's broken in production?' without writing APL.",
      inputSchema: {
        dataset: z.string().min(1).optional(),
        window: z.string().optional(),
        limit: z.number().int().min(1).max(1000).optional(),
      },
    },
    async (args) => withClient((client) => client.recentErrors(args)),
  );

  server.registerTool(
    "axiomGetTraceById",
    {
      description:
        "Convenience: fetch all events for one traceId across the last 7 days. USE THIS to debug a specific request when you know the trace id.",
      inputSchema: {
        traceId: z.string().min(1),
        dataset: z.string().min(1).optional(),
      },
    },
    async (args) => withClient((client) => client.getTraceById(args)),
  );

  // -- Dashboards ----------------------------------------------------------
  //
  // The agent's loop for dashboard work:
  //
  //   1. axiomListDashboards / axiomFindDashboardByUid — discover what
  //      already exists. ALWAYS look up by uid first when provisioning,
  //      to avoid creating duplicates.
  //   2. axiomCreateDashboard — first-time provisioning. Pass uid for
  //      stable lookup ("zero-frame-<project>").
  //   3. axiomAddChart / axiomUpdateChart / axiomRemoveChart — granular
  //      edits as the user asks ("add a panel for X", "remove the unused
  //      one", "change the time window on panel Y"). PREFER these over
  //      coarse updateDashboard for the agent loop.
  //   4. axiomDeleteDashboard — only when the user explicitly asks to.

  server.registerTool(
    "axiomListDashboards",
    {
      description:
        "List all Axiom dashboards visible to this token. Each item includes id, uid (custom), name, and version. Use first when looking for an existing dashboard.",
    },
    async () => withClient((client) => client.listDashboards()),
  );

  server.registerTool(
    "axiomGetDashboard",
    {
      description:
        "Fetch one dashboard's full contents by uid. Axiom's single-dashboard endpoints key on uid (the stable user-set or auto-generated identifier), NOT the internal `id` returned in list responses. Response includes the dashboard body AND a `version` integer — pass that version to axiomUpdateDashboard / axiomAddChart / axiomUpdateChart / axiomRemoveChart to avoid lost-update races.",
      inputSchema: {
        uid: z.string().min(1),
      },
    },
    async (args) => withClient((client) => client.getDashboard(args)),
  );

  server.registerTool(
    "axiomFindDashboardByUid",
    {
      description:
        "Look up a dashboard by its custom `uid` field. Returns null when not found (does not throw). Use this for idempotent provisioning: call before axiomCreateDashboard so you don't create duplicates. The Zeroframe default dashboard uses uid `zero-frame-<project-slug>`.",
      inputSchema: {
        uid: z.string().min(1),
      },
    },
    async (args) => withClient((client) => client.findDashboardByUid(args)),
  );

  server.registerTool(
    "axiomCreateDashboard",
    {
      description:
        "Create a new Axiom dashboard. Minimal usage: pass `name`. To make the dashboard idempotently findable, also pass `uid` (string, e.g. \"zero-frame-myapp\"). To pre-populate panels, pass `charts[]` (each: { id, type, name, query, ...}) and matching `layout[]` (each: { i: chart.id, x, y, w, h }). Sensible defaults for owner, schemaVersion, refreshTime, timeWindow* are filled in if omitted. Chart types: TimeSeries, Heatmap, LogStream, Pie, Scatter, Table, TopK, Statistic, Note, MonitorList, SmartFilter, Spacer.",
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
    },
    async (args) => withClient((client) => client.createDashboard(args)),
  );

  server.registerTool(
    "axiomUpdateDashboard",
    {
      description:
        "Replace a dashboard's contents wholesale. Requires `uid` and `version` (from a prior get — Axiom enforces optimistic concurrency). For incremental panel edits PREFER the granular tools (axiomAddChart, axiomUpdateChart, axiomRemoveChart) — they handle the version dance for you. Pass `overwrite: true` to skip the version check (last-write-wins).",
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
    },
    async (args) => withClient((client) => client.updateDashboard(args)),
  );

  server.registerTool(
    "axiomDeleteDashboard",
    {
      description:
        "Permanently delete a dashboard by uid. USE THIS only when the user explicitly asks — there is no undo.",
      inputSchema: {
        uid: z.string().min(1),
      },
    },
    async (args) => withClient((client) => client.deleteDashboard(args)),
  );

  server.registerTool(
    "axiomAddChart",
    {
      description:
        "Append a chart (panel) to an existing dashboard. Reads the current dashboard, appends the chart and a layout entry, writes the dashboard back atomically (using the current version). USE THIS when the user asks to add a panel like \"show me failed logins by hour\". Layout is auto-generated (full-width, stacked below existing) if not provided.",
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
    },
    async (args) => withClient((client) => client.addChart(args)),
  );

  server.registerTool(
    "axiomUpdateChart",
    {
      description:
        "Patch one chart in a dashboard by its chart id. Merges the partial fields into the existing chart, leaves all other charts untouched. USE THIS when the user asks to retitle/rescope/retype a specific panel without disturbing the rest.",
      inputSchema: {
        dashboardUid: z.string().min(1),
        chartId: z.string().min(1),
        name: z.string().optional(),
        type: z.string().optional(),
        query: z.any().optional(),
        tableSettings: z.any().optional(),
        text: z.string().optional(),
      },
    },
    async (args) => withClient((client) => client.updateChart(args)),
  );

  server.registerTool(
    "axiomRemoveChart",
    {
      description:
        "Remove one chart (and its layout entry) from a dashboard. No-op if the chart id isn't present. USE THIS when the user asks to drop a specific panel.",
      inputSchema: {
        dashboardUid: z.string().min(1),
        chartId: z.string().min(1),
      },
    },
    async (args) => withClient((client) => client.removeChart(args)),
  );

  return server;
};

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (args.includes("--connect")) {
  const result = await runAxiomBrowserAuthFlow();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (args.includes("--auth-status")) {
  process.stdout.write(`${JSON.stringify(getAxiomAuthStatus(), null, 2)}\n`);
  process.exit(0);
}

if (args.includes("--test-connection")) {
  const client = createAxiomClient();
  const validation = await client.validateToken();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: validation.ok,
        tokenSource: client.auth.source,
        defaultDataset: client.auth.defaultDataset,
        validation,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const transport = new StdioServerTransport();
await createServer().connect(transport);
