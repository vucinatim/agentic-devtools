#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  disconnectRailway,
  RAILWAY_AUTH_CONFIG_PATH,
  runRailwayBrowserAuthFlow,
} from "./auth.mjs";
import {
  createRailwayClient,
  getRailwayAuthStatus,
} from "./client.mjs";

const HELP_TEXT = `Usage: agentic-devtools mcp railway

Railway MCP server

Optional environment variables:
  RAILWAY_PROJECT_TOKEN
  RAILWAY_API_TOKEN
  RAILWAY_TOKEN
  RAILWAY_PROJECT_ID
  RAILWAY_API_ENDPOINT

Project tokens can inspect a single project. Account tokens can inspect account identity and list projects.

If env vars are not provided, use the connectRailway tool to open the browser-based setup flow and save a local Railway token.
`;

const createToolResult = (value) => ({
  content: [
    {
      type: "text",
      text: JSON.stringify(value, null, 2),
    },
  ],
  structuredContent: value,
});

const createServer = () => {
  const server = new McpServer(
    {
      name: "railway",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools for read-only Railway project, environment, service, domain, and deployment inspection. Do not attempt deployment or variable mutation through this plugin.",
    },
  );

  const withClient = async (callback) => {
    const client = createRailwayClient();
    return callback(client);
  };

  server.registerTool(
    "getRailwayAuthStatus",
    {
      description:
        "Show whether Railway credentials are configured and which token scope will be used.",
    },
    async () => createToolResult(getRailwayAuthStatus()),
  );

  server.registerTool(
    "testRailwayConnection",
    {
      description:
        "Verify that the configured Railway credentials can successfully call the API.",
    },
    async () =>
      createToolResult(
        await withClient(async (client) => {
          if (client.auth.kind === "project") {
            const context = await client.getProjectTokenContext();
            return {
              ok: true,
              tokenSource: client.auth.source,
              tokenKind: client.auth.kind,
              project: {
                id: context.project.id,
                name: context.project.name,
              },
              environment: {
                id: context.environment.id,
                name: context.environment.name,
              },
            };
          }

          const validation = await client.validateAccountToken();
          return {
            ok: true,
            tokenSource: client.auth.source,
            tokenKind: client.auth.kind,
            validation,
          };
        }),
      ),
  );

  server.registerTool(
    "connectRailway",
    {
      description:
        "Open a browser-based setup flow for a Railway account or project token and save it locally for this MCP server.",
    },
    async () =>
      createToolResult({
        ...(await runRailwayBrowserAuthFlow()),
        configPath: RAILWAY_AUTH_CONFIG_PATH,
      }),
  );

  server.registerTool(
    "disconnectRailway",
    {
      description:
        "Remove the locally stored Railway token from the plugin auth file.",
    },
    async () => createToolResult(await disconnectRailway()),
  );

  server.registerTool(
    "getRailwayViewer",
    {
      description:
        "Inspect the current Railway account identity. Requires RAILWAY_API_TOKEN or RAILWAY_TOKEN.",
    },
    async () =>
      createToolResult(
        await withClient(async (client) => ({
          tokenSource: client.auth.source,
          viewer: await client.getCurrentViewer(),
        })),
      ),
  );

  server.registerTool(
    "listRailwayProjects",
    {
      description:
        "List Railway projects for the configured account token. Requires RAILWAY_API_TOKEN or RAILWAY_TOKEN.",
      inputSchema: {
        workspaceId: z.string().min(1).optional(),
        includeDeleted: z.boolean().optional(),
        first: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.listProjects(args ?? {})),
      ),
  );

  server.registerTool(
    "inspectRailwayProjectToken",
    {
      description:
        "Inspect the project and environment attached to the configured RAILWAY_PROJECT_TOKEN.",
    },
    async () =>
      createToolResult(
        await withClient((client) => client.getProjectTokenContext()),
      ),
  );

  server.registerTool(
    "getRailwayProject",
    {
      description:
        "Inspect one Railway project. Pass projectId, set RAILWAY_PROJECT_ID, or use RAILWAY_PROJECT_TOKEN.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ projectId } = {}) =>
      createToolResult(
        await withClient((client) => client.getProject(projectId)),
      ),
  );

  server.registerTool(
    "listRailwayEnvironments",
    {
      description:
        "List environments for one Railway project. Pass projectId, set RAILWAY_PROJECT_ID, or use RAILWAY_PROJECT_TOKEN.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
        isEphemeral: z.boolean().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.listEnvironments(args ?? {})),
      ),
  );

  server.registerTool(
    "getRailwayEnvironment",
    {
      description:
        "Inspect one Railway environment, including service instances, domains, and latest deployment status.",
      inputSchema: {
        environmentId: z.string().min(1),
      },
    },
    async ({ environmentId }) =>
      createToolResult(
        await withClient((client) => client.getEnvironment(environmentId)),
      ),
  );

  server.registerTool(
    "doctorRailwayProject",
    {
      description:
        "Return a compact project health summary for the primary Railway environment and service deployments.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ projectId } = {}) =>
      createToolResult(
        await withClient((client) => client.doctorProject({ projectId })),
      ),
  );

  return server;
};

const argv = process.argv.slice(2);

if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (argv.includes("--auth-status")) {
  process.stdout.write(`${JSON.stringify(getRailwayAuthStatus(), null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--connect")) {
  process.stdout.write("Opening Railway browser setup flow...\n");
  const result = await runRailwayBrowserAuthFlow();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--test-connection")) {
  const client = createRailwayClient();
  const result =
    client.auth.kind === "project"
      ? await client.getProjectTokenContext()
      : await client.validateAccountToken();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        tokenSource: client.auth.source,
        tokenKind: client.auth.kind,
        result,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const server = createServer();
const transport = new StdioServerTransport();

await server.connect(transport);
