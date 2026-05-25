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
