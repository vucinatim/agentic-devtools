#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapToolHandler } from "../../core/result.mjs";
import {
  AXIOM_AUTH_CONFIG_PATH,
  disconnectAxiom,
  getAxiomAuthStatus,
  runAxiomBrowserAuthFlow,
} from "./auth.mjs";
import { createAxiomClient } from "./client.mjs";
import { mapAxiomError } from "./error-mapper.mjs";
import { axiomOperations } from "./operations.mjs";

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

  // -- Data operations ------------------------------------------------------
  // Registered from the shared operations registry (operations.mjs), which the
  // CLI surface (cli.mjs) also consumes. One client, injected into each
  // handler via `extra`. The server.registerTool override above auto-wraps
  // each handler with the structured-error middleware.
  const client = createAxiomClient();
  for (const op of axiomOperations) {
    server.registerTool(
      op.mcpName,
      {
        description: op.description,
        ...(op.inputSchema ? { inputSchema: op.inputSchema } : {}),
      },
      (args) => op.handler(args ?? {}, { client }),
    );
  }

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
