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

Project tokens can manage resources scoped to the attached project environment.
Account and workspace tokens can inspect and manage broader Railway resources.

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
        "Use these tools to inspect and manage Railway projects, environments, services, domains, variables, deployments, and volumes through the documented public API. Prefer read tools first, then use targeted write tools. Delete tools are destructive and should be used deliberately.",
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
    "listRailwayProjectMembers",
    {
      description:
        "List members of a Railway project. Requires an account or workspace token.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ projectId } = {}) =>
      createToolResult(
        await withClient((client) => client.getProjectMembers(projectId)),
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
    "createRailwayProject",
    {
      description:
        "Create a Railway project. Requires an account or workspace token.",
      inputSchema: {
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        workspaceId: z.string().min(1).optional(),
        defaultEnvironmentName: z.string().min(1).optional(),
        isMonorepo: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        prDeploys: z.boolean().optional(),
        runtime: z.string().min(1).optional(),
        repo: z.unknown().optional(),
      },
    },
    async (args = {}) =>
      createToolResult(await withClient((client) => client.createProject(args))),
  );

  server.registerTool(
    "updateRailwayProject",
    {
      description:
        "Update Railway project settings such as name, description, or PR environment behavior.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        baseEnvironmentId: z.string().min(1).optional(),
        botPrEnvironments: z.boolean().optional(),
        focusedPrEnvironments: z.boolean().optional(),
        isPublic: z.boolean().optional(),
        prDeploys: z.boolean().optional(),
      },
    },
    async (args = {}) =>
      createToolResult(await withClient((client) => client.updateProject(args))),
  );

  server.registerTool(
    "deleteRailwayProject",
    {
      description:
        "Delete a Railway project. Destructive. Requires an account or workspace token.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
      },
    },
    async ({ projectId } = {}) =>
      createToolResult(await withClient((client) => client.deleteProject(projectId))),
  );

  server.registerTool(
    "transferRailwayProject",
    {
      description:
        "Transfer a Railway project to another workspace. Requires an account or workspace token.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
        workspaceId: z.string().min(1),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.transferProject(args))),
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
    "createRailwayEnvironment",
    {
      description:
        "Create a Railway environment inside a project.",
      inputSchema: {
        projectId: z.string().min(1),
        name: z.string().min(1),
        ephemeral: z.boolean().optional(),
        sourceEnvironmentId: z.string().min(1).optional(),
        skipInitialDeploys: z.boolean().optional(),
        stageInitialChanges: z.boolean().optional(),
        applyChangesInBackground: z.boolean().optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.createEnvironment(args))),
  );

  server.registerTool(
    "deleteRailwayEnvironment",
    {
      description:
        "Delete a Railway environment. Destructive.",
      inputSchema: {
        environmentId: z.string().min(1),
      },
    },
    async ({ environmentId }) =>
      createToolResult(
        await withClient((client) => client.deleteEnvironment(environmentId)),
      ),
  );

  server.registerTool(
    "getRailwayService",
    {
      description: "Inspect one Railway service.",
      inputSchema: {
        serviceId: z.string().min(1),
      },
    },
    async ({ serviceId }) =>
      createToolResult(await withClient((client) => client.getService(serviceId))),
  );

  server.registerTool(
    "getRailwayServiceInstance",
    {
      description:
        "Inspect one Railway service instance in a specific environment.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.getServiceInstance(args)),
      ),
  );

  server.registerTool(
    "getRailwayServiceInstanceLimits",
    {
      description:
        "Get resource limits for a Railway service instance.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.getServiceInstanceLimits(args)),
      ),
  );

  server.registerTool(
    "createRailwayService",
    {
      description:
        "Create a Railway service from a repo, image, template, or as an empty service.",
      inputSchema: {
        projectId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        icon: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
        templateId: z.string().min(1).optional(),
        templateServiceId: z.string().min(1).optional(),
        source: z.unknown().optional(),
        registryCredentials: z.unknown().optional(),
        variables: z.unknown().optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.createService(args))),
  );

  server.registerTool(
    "updateRailwayService",
    {
      description:
        "Update a Railway service name or icon.",
      inputSchema: {
        serviceId: z.string().min(1),
        name: z.string().min(1).optional(),
        icon: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.updateService(args))),
  );

  server.registerTool(
    "connectRailwayService",
    {
      description:
        "Connect an existing Railway service to a repo or image source.",
      inputSchema: {
        serviceId: z.string().min(1),
        repo: z.string().min(1).optional(),
        image: z.string().min(1).optional(),
        branch: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.connectService(args))),
  );

  server.registerTool(
    "disconnectRailwayService",
    {
      description:
        "Disconnect a Railway service from its current source.",
      inputSchema: {
        serviceId: z.string().min(1),
      },
    },
    async ({ serviceId }) =>
      createToolResult(
        await withClient((client) => client.disconnectService(serviceId)),
      ),
  );

  server.registerTool(
    "deleteRailwayService",
    {
      description:
        "Delete a Railway service. Destructive.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.deleteService(args))),
  );

  server.registerTool(
    "updateRailwayServiceInstance",
    {
      description:
        "Update build, deploy, region, healthcheck, cron, or source settings for a Railway service instance.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        buildCommand: z.string().optional(),
        builder: z.string().min(1).optional(),
        cronSchedule: z.string().optional(),
        dockerfilePath: z.string().optional(),
        drainingSeconds: z.number().int().min(0).optional(),
        healthcheckPath: z.string().optional(),
        healthcheckTimeout: z.number().int().min(0).optional(),
        ipv6EgressEnabled: z.boolean().optional(),
        multiRegionConfig: z.unknown().optional(),
        nixpacksPlan: z.unknown().optional(),
        numReplicas: z.number().int().min(0).optional(),
        overlapSeconds: z.number().int().min(0).optional(),
        preDeployCommand: z.array(z.string()).optional(),
        railwayConfigFile: z.string().optional(),
        region: z.string().optional(),
        registryCredentials: z.unknown().optional(),
        restartPolicyMaxRetries: z.number().int().min(0).optional(),
        restartPolicyType: z.string().min(1).optional(),
        rootDirectory: z.string().optional(),
        sleepApplication: z.boolean().optional(),
        source: z.unknown().optional(),
        startCommand: z.string().optional(),
        watchPatterns: z.array(z.string()).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.updateServiceInstance(args)),
      ),
  );

  server.registerTool(
    "deployRailwayService",
    {
      description:
        "Trigger a Railway deployment for a service instance.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
        commitSha: z.string().min(1).optional(),
        latestCommit: z.boolean().optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.deployService(args))),
  );

  server.registerTool(
    "redeployRailwayService",
    {
      description:
        "Redeploy the latest Railway deployment for a service instance.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.redeployService(args))),
  );

  server.registerTool(
    "updateRailwayServiceInstanceLimits",
    {
      description:
        "Update vCPU or memory limits for a Railway service instance.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
        memoryGB: z.number().positive().optional(),
        vCPUs: z.number().positive().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.updateServiceInstanceLimits(args)),
      ),
  );

  server.registerTool(
    "getRailwayDeployment",
    {
      description: "Inspect one Railway deployment.",
      inputSchema: {
        deploymentId: z.string().min(1),
      },
    },
    async ({ deploymentId }) =>
      createToolResult(
        await withClient((client) => client.getDeployment(deploymentId)),
      ),
  );

  server.registerTool(
    "listRailwayDeployments",
    {
      description:
        "List Railway deployments for a project, environment, or service.",
      inputSchema: {
        projectId: z.string().min(1).optional(),
        environmentId: z.string().min(1).optional(),
        serviceId: z.string().min(1).optional(),
        first: z.number().int().min(1).max(100).optional(),
        after: z.string().min(1).optional(),
        before: z.string().min(1).optional(),
        last: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args = {}) =>
      createToolResult(await withClient((client) => client.listDeployments(args))),
  );

  server.registerTool(
    "upsertRailwayVariable",
    {
      description:
        "Create or update a Railway variable.",
      inputSchema: {
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        name: z.string().min(1),
        value: z.string(),
        serviceId: z.string().min(1).optional(),
        skipDeploys: z.boolean().optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.upsertVariable(args))),
  );

  server.registerTool(
    "deleteRailwayVariable",
    {
      description:
        "Delete a Railway variable.",
      inputSchema: {
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        name: z.string().min(1),
        serviceId: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.deleteVariable(args))),
  );

  server.registerTool(
    "createRailwayServiceDomain",
    {
      description:
        "Create a Railway-managed service domain.",
      inputSchema: {
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
        targetPort: z.number().int().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.createServiceDomain(args)),
      ),
  );

  server.registerTool(
    "updateRailwayServiceDomain",
    {
      description:
        "Update a Railway-managed service domain target port or domain binding.",
      inputSchema: {
        serviceDomainId: z.string().min(1),
        serviceId: z.string().min(1),
        environmentId: z.string().min(1),
        domain: z.string().min(1),
        targetPort: z.number().int().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.updateServiceDomain(args)),
      ),
  );

  server.registerTool(
    "deleteRailwayServiceDomain",
    {
      description:
        "Delete a Railway-managed service domain.",
      inputSchema: {
        serviceDomainId: z.string().min(1),
      },
    },
    async ({ serviceDomainId }) =>
      createToolResult(
        await withClient((client) => client.deleteServiceDomain(serviceDomainId)),
      ),
  );

  server.registerTool(
    "createRailwayCustomDomain",
    {
      description:
        "Add a custom domain to a Railway service.",
      inputSchema: {
        projectId: z.string().min(1),
        environmentId: z.string().min(1),
        serviceId: z.string().min(1),
        domain: z.string().min(1),
        targetPort: z.number().int().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.createCustomDomain(args)),
      ),
  );

  server.registerTool(
    "updateRailwayCustomDomain",
    {
      description:
        "Update a custom Railway domain target port.",
      inputSchema: {
        customDomainId: z.string().min(1),
        environmentId: z.string().min(1),
        targetPort: z.number().int().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.updateCustomDomain(args)),
      ),
  );

  server.registerTool(
    "deleteRailwayCustomDomain",
    {
      description:
        "Delete a custom Railway domain.",
      inputSchema: {
        customDomainId: z.string().min(1),
      },
    },
    async ({ customDomainId }) =>
      createToolResult(
        await withClient((client) => client.deleteCustomDomain(customDomainId)),
      ),
  );

  server.registerTool(
    "createRailwayVolume",
    {
      description:
        "Create a Railway volume.",
      inputSchema: {
        projectId: z.string().min(1),
        mountPath: z.string().min(1),
        environmentId: z.string().min(1).optional(),
        serviceId: z.string().min(1).optional(),
        region: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.createVolume(args))),
  );

  server.registerTool(
    "deleteRailwayVolume",
    {
      description:
        "Delete a Railway volume. Destructive.",
      inputSchema: {
        volumeId: z.string().min(1),
      },
    },
    async ({ volumeId }) =>
      createToolResult(await withClient((client) => client.deleteVolume(volumeId))),
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
