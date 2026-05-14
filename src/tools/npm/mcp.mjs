#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  disconnectNpm,
  getNpmAuthStatus,
  NPM_AUTH_CONFIG_PATH,
  runNpmBrowserAuthFlow,
} from "./auth.mjs";
import { createNpmClient } from "./client.mjs";

const HELP_TEXT = `Usage: agentic-devtools mcp npm

npm MCP server

Optional environment variables:
  NPM_TOKEN
  NODE_AUTH_TOKEN
  NPM_CONFIG_REGISTRY
  AGENTIC_DEVTOOLS_NPM_AUTH_CONFIG_PATH

Prefer GitHub Actions Trusted Publishing for real package publishing. Local publishing is supported but explicit confirmation is required.
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

const packageNameSchema = z.string().min(1);

const createServer = () => {
  const server = new McpServer(
    {
      name: "npm",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools for npm registry inspection, token status checks, trusted publishing verification, and explicitly confirmed publishing. Prefer GitHub Actions Trusted Publishing over local write tokens.",
    },
  );

  const withClient = async (callback) => {
    const client = createNpmClient();
    return callback(client);
  };

  server.registerTool(
    "getNpmAuthStatus",
    {
      description:
        "Show whether npm credentials are configured without exposing token values.",
    },
    async () => createToolResult(getNpmAuthStatus()),
  );

  server.registerTool(
    "connectNpm",
    {
      description:
        "Open a browser-based guided setup flow for an npm granular token.",
    },
    async () =>
      createToolResult({
        ...(await runNpmBrowserAuthFlow()),
        configPath: NPM_AUTH_CONFIG_PATH,
      }),
  );

  server.registerTool(
    "disconnectNpm",
    {
      description: "Remove the locally stored npm token from Agentic Devtools.",
    },
    async () => createToolResult(await disconnectNpm()),
  );

  server.registerTool(
    "testNpmConnection",
    {
      description:
        "Verify that the configured npm token can call the npm registry identity endpoint.",
    },
    async () =>
      createToolResult(
        await withClient(async (client) => ({
          ok: true,
          tokenSource: client.auth.source,
          registry: client.registry,
          user: await client.getCurrentUser(),
        })),
      ),
  );

  server.registerTool(
    "getNpmPackageInfo",
    {
      description: "Fetch public package metadata from the npm registry.",
      inputSchema: {
        packageName: packageNameSchema,
      },
    },
    async ({ packageName }) =>
      createToolResult(
        await withClient((client) => client.getPackageInfo(packageName)),
      ),
  );

  server.registerTool(
    "checkNpmPackageNameAvailability",
    {
      description: "Check if a package name is available on npm.",
      inputSchema: {
        packageName: packageNameSchema,
      },
    },
    async ({ packageName }) =>
      createToolResult(
        await withClient((client) =>
          client.checkPackageNameAvailability(packageName),
        ),
      ),
  );

  server.registerTool(
    "getNpmPackageVersions",
    {
      description: "List published versions and latest tag for an npm package.",
      inputSchema: {
        packageName: packageNameSchema,
      },
    },
    async ({ packageName }) =>
      createToolResult(
        await withClient((client) => client.getPackageVersions(packageName)),
      ),
  );

  server.registerTool(
    "getNpmPackageDistTags",
    {
      description: "List npm dist-tags for a package.",
      inputSchema: {
        packageName: packageNameSchema,
      },
    },
    async ({ packageName }) =>
      createToolResult(
        await withClient((client) => client.getPackageDistTags(packageName)),
      ),
  );

  server.registerTool(
    "getNpmPackageVisibility",
    {
      description:
        "Get npm package visibility. Requires an npm token with access to the package.",
      inputSchema: {
        packageName: packageNameSchema,
      },
    },
    async ({ packageName }) =>
      createToolResult(
        await withClient((client) => client.getPackageVisibility(packageName)),
      ),
  );

  server.registerTool(
    "setNpmPackageAccess",
    {
      description:
        "Set npm package access and optional 2FA publishing policy. Requires explicit inputs and a token with package admin rights.",
      inputSchema: {
        packageName: packageNameSchema,
        access: z.enum(["public", "private"]).default("public"),
        publishRequiresTfa: z.boolean().optional(),
        automationTokenOverridesTfa: z.boolean().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.setPackageAccess(args)),
      ),
  );

  server.registerTool(
    "listNpmTokens",
    {
      description:
        "List npm access tokens for the configured user. Token values are redacted by npm.",
      inputSchema: {
        page: z.number().int().min(0).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.listTokens(args ?? {})),
      ),
  );

  server.registerTool(
    "exchangeNpmOidcToken",
    {
      description:
        "Exchange a supported CI OIDC id_token for a short-lived npm registry token for one package. Usually npm CLI handles this inside GitHub Actions.",
      inputSchema: {
        packageName: packageNameSchema,
        oidcToken: z.string().min(1),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.exchangeOidcToken(args)),
      ),
  );

  server.registerTool(
    "getNpmTrustedPublishers",
    {
      description:
        "Get npm Trusted Publisher configurations for a package. Requires package write permission and usually npm 2FA OTP.",
      inputSchema: {
        packageName: packageNameSchema,
        otp: z.string().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.getTrustedPublishers(args)),
      ),
  );

  server.registerTool(
    "addNpmGitHubTrustedPublisher",
    {
      description:
        "Add a GitHub Actions Trusted Publisher for an npm package. Requires package write permission and usually npm 2FA OTP.",
      inputSchema: {
        packageName: packageNameSchema,
        repository: z.string().min(1),
        workflowFile: z.string().min(1).default("publish.yml"),
        environment: z.string().optional(),
        otp: z.string().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.addGitHubTrustedPublisher(args)),
      ),
  );

  server.registerTool(
    "deleteNpmTrustedPublisher",
    {
      description:
        "Delete a Trusted Publisher configuration by UUID. Requires package write permission and usually npm 2FA OTP.",
      inputSchema: {
        packageName: packageNameSchema,
        configId: z.string().min(1),
        otp: z.string().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.deleteTrustedPublisher(args)),
      ),
  );

  server.registerTool(
    "publishNpmPackageDirectory",
    {
      description:
        "Run npm publish for a local package directory. Defaults to dry-run. Real publishing requires confirm='publish <name>@<version>'. Prefer GitHub Actions Trusted Publishing.",
      inputSchema: {
        cwd: z.string().min(1).optional(),
        tag: z.string().min(1).default("latest"),
        access: z.enum(["public", "restricted"]).default("public"),
        dryRun: z.boolean().default(true),
        confirm: z.string().optional(),
      },
    },
    async (args) =>
      createToolResult(
        await withClient((client) => client.publishPackageDirectory(args)),
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
  process.stdout.write(`${JSON.stringify(getNpmAuthStatus(), null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--connect")) {
  process.stdout.write("Opening npm browser setup flow...\n");
  const result = await runNpmBrowserAuthFlow({
    onReady: ({ url }) => {
      process.stdout.write(`npm setup URL: ${url}\n`);
    },
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--test-connection")) {
  const client = createNpmClient();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        tokenSource: client.auth.source,
        registry: client.registry,
        user: await client.getCurrentUser(),
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
