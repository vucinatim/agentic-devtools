#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createJsonResult } from "../../core/result.mjs";
import {
  CLOUDFLARE_AUTH_CONFIG_PATH,
  disconnectCloudflare,
  getCloudflareAuthStatus,
  runCloudflareBrowserAuthFlow,
} from "./auth.mjs";
import { createCloudflareClient } from "./client.mjs";

const HELP_TEXT = `Usage: agentic-devtools mcp cloudflare

Cloudflare MCP server

Optional environment variables:
  CLOUDFLARE_API_TOKEN
  CLOUDFLARE_ACCOUNT_ID
  CLOUDFLARE_ZONE_ID
  CLOUDFLARE_API_BASE_URL
  CLOUDFLARE_AUTH_CONFIG_PATH

Standalone flags:
  --connect
  --auth-status
  --test-connection

Use a scoped Cloudflare API token. This MCP surface is designed for DNS, Cloudflare Tunnel, and R2 bucket/domain management.
`;

const dnsRecordTypeSchema = z.enum([
  "A",
  "AAAA",
  "CAA",
  "CNAME",
  "HTTPS",
  "MX",
  "NS",
  "PTR",
  "SRV",
  "SVCB",
  "TLSA",
  "TXT",
  "URI",
]);

const bucketJurisdictionSchema = z.enum(["default", "eu", "fedramp"]);
const bucketLocationSchema = z.enum(["apac", "eeur", "enam", "weur", "wnam", "oc"]);
const bucketStorageClassSchema = z.enum(["Standard", "InfrequentAccess"]);
const minTlsSchema = z.enum(["1.0", "1.1", "1.2", "1.3"]);
const tunnelConfigSourceSchema = z.enum(["cloudflare", "local"]);

const createServer = () => {
  const server = new McpServer(
    {
      name: "cloudflare",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools to inspect and manage Cloudflare DNS zones, DNS records, Cloudflare Tunnels, and R2 bucket/domain configuration. Prefer explicit CRUD operations over vague mutation requests.",
    },
  );

  const withClient = async (callback) => {
    const client = createCloudflareClient();
    return callback(client);
  };

  server.registerTool(
    "getCloudflareAuthStatus",
    {
      description:
        "Show whether Cloudflare credentials are configured without exposing token values.",
    },
    async () => createJsonResult(getCloudflareAuthStatus()),
  );

  server.registerTool(
    "connectCloudflare",
    {
      description:
        "Open a browser-based guided setup flow for a Cloudflare API token.",
    },
    async () =>
      createJsonResult({
        ...(await runCloudflareBrowserAuthFlow()),
        configPath: CLOUDFLARE_AUTH_CONFIG_PATH,
      }),
  );

  server.registerTool(
    "disconnectCloudflare",
    {
      description:
        "Remove the locally stored Cloudflare token from Agentic Devtools.",
    },
    async () => createJsonResult(await disconnectCloudflare()),
  );

  server.registerTool(
    "testCloudflareConnection",
    {
      description:
        "Verify that the configured Cloudflare token is active and optionally show the configured default account or zone context.",
    },
    async () =>
      createJsonResult(
        await withClient(async (client) => ({
          ok: true,
          tokenSource: client.auth.source,
          defaultAccountId: client.auth.defaultAccountId,
          defaultZoneId: client.auth.defaultZoneId,
          validation: await client.validateToken(),
        })),
      ),
  );

  server.registerTool(
    "listCloudflareTunnels",
    {
      description:
        "List Cloudflare Tunnels in one account. Pass accountId, accountName, or set CLOUDFLARE_ACCOUNT_ID.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        isDeleted: z.boolean().optional(),
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.listTunnels(args))),
  );

  server.registerTool(
    "getCloudflareTunnel",
    {
      description:
        "Get one Cloudflare Tunnel by id or name within an account.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.getTunnel(args))),
  );

  server.registerTool(
    "createCloudflareTunnel",
    {
      description:
        "Create a Cloudflare Tunnel. Remotely managed tunnels should use configSource=cloudflare. Locally managed tunnels require tunnelSecret.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        name: z.string().min(1),
        configSource: tunnelConfigSourceSchema.optional(),
        tunnelSecret: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.createTunnel(args))),
  );

  server.registerTool(
    "updateCloudflareTunnel",
    {
      description:
        "Rename a Cloudflare Tunnel or rotate its local tunnel secret.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        tunnelSecret: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.updateTunnel(args))),
  );

  server.registerTool(
    "deleteCloudflareTunnel",
    {
      description: "Delete a Cloudflare Tunnel.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.deleteTunnel(args))),
  );

  server.registerTool(
    "getCloudflareTunnelToken",
    {
      description:
        "Get the token that a cloudflared connector uses to join a specific tunnel.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.getTunnelToken(args))),
  );

  server.registerTool(
    "getCloudflareTunnelConfiguration",
    {
      description: "Get the current remote configuration for a Cloudflare Tunnel.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.getTunnelConfiguration(args)),
      ),
  );

  server.registerTool(
    "updateCloudflareTunnelConfiguration",
    {
      description:
        "Replace the remote configuration for a remotely managed Cloudflare Tunnel.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
        config: z.record(z.string(), z.unknown()),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.updateTunnelConfiguration(args)),
      ),
  );

  server.registerTool(
    "listCloudflareTunnelConnections",
    {
      description:
        "List active or recently tracked connections for a Cloudflare Tunnel.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.listTunnelConnections(args)),
      ),
  );

  server.registerTool(
    "cleanupCloudflareTunnelConnections",
    {
      description:
        "Ask Cloudflare to drop tracked connections for a tunnel. Optionally scope cleanup to one connector clientId.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        tunnelId: z.string().min(1).optional(),
        tunnelName: z.string().min(1).optional(),
        clientId: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.cleanupTunnelConnections(args)),
      ),
  );

  server.registerTool(
    "listCloudflareZones",
    {
      description: "List Cloudflare zones accessible to the configured token.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        status: z.string().min(1).optional(),
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.listZones(args))),
  );

  server.registerTool(
    "listCloudflareAccounts",
    {
      description:
        "List Cloudflare accounts accessible to the configured token. This is useful when you want to target R2 operations by account name instead of raw account id.",
      inputSchema: {
        name: z.string().min(1).optional(),
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.listAccounts(args))),
  );

  server.registerTool(
    "getCloudflareZone",
    {
      description:
        "Get Cloudflare zone details. Pass zoneId or set CLOUDFLARE_ZONE_ID.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
      },
    },
    async ({ zoneId } = {}) =>
      createJsonResult(await withClient((client) => client.getZone(zoneId))),
  );

  server.registerTool(
    "listCloudflareDnsRecords",
    {
      description:
        "List DNS records in a Cloudflare zone. Pass zoneId or set CLOUDFLARE_ZONE_ID.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        name: z.string().min(1).optional(),
        type: dnsRecordTypeSchema.optional(),
        content: z.string().optional(),
        page: z.number().int().min(1).optional(),
        perPage: z.number().int().min(1).max(100).optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.listDnsRecords(args))),
  );

  server.registerTool(
    "getCloudflareDnsRecord",
    {
      description: "Get one DNS record by id.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        recordId: z.string().min(1),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.getDnsRecord(args))),
  );

  server.registerTool(
    "createCloudflareDnsRecord",
    {
      description: "Create a Cloudflare DNS record.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        type: dnsRecordTypeSchema,
        name: z.string().min(1),
        content: z.string().min(1),
        ttl: z.number().int().min(1).optional(),
        proxied: z.boolean().optional(),
        priority: z.number().int().min(0).optional(),
        comment: z.string().optional(),
        tags: z.array(z.string()).optional(),
        data: z.unknown().optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.createDnsRecord(args))),
  );

  server.registerTool(
    "updateCloudflareDnsRecord",
    {
      description: "Update a Cloudflare DNS record.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        recordId: z.string().min(1),
        type: dnsRecordTypeSchema.optional(),
        name: z.string().min(1).optional(),
        content: z.string().min(1).optional(),
        ttl: z.number().int().min(1).optional(),
        proxied: z.boolean().optional(),
        priority: z.number().int().min(0).optional(),
        comment: z.string().optional(),
        tags: z.array(z.string()).optional(),
        data: z.unknown().optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.updateDnsRecord(args))),
  );

  server.registerTool(
    "deleteCloudflareDnsRecord",
    {
      description: "Delete a Cloudflare DNS record.",
      inputSchema: {
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        recordId: z.string().min(1),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.deleteDnsRecord(args))),
  );

  server.registerTool(
    "listCloudflareR2Buckets",
    {
      description:
        "List R2 buckets in one Cloudflare account. Pass accountId, accountName, or set CLOUDFLARE_ACCOUNT_ID.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        jurisdiction: bucketJurisdictionSchema.optional(),
      },
    },
    async (args = {}) =>
      createJsonResult(await withClient((client) => client.listR2Buckets(args))),
  );

  server.registerTool(
    "getCloudflareR2Bucket",
    {
      description: "Get one R2 bucket by name.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        jurisdiction: bucketJurisdictionSchema.optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.getR2Bucket(args))),
  );

  server.registerTool(
    "createCloudflareR2Bucket",
    {
      description: "Create an R2 bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        locationHint: bucketLocationSchema.optional(),
        storageClass: bucketStorageClassSchema.optional(),
        jurisdiction: bucketJurisdictionSchema.optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.createR2Bucket(args))),
  );

  server.registerTool(
    "updateCloudflareR2Bucket",
    {
      description:
        "Update mutable R2 bucket properties such as storage class and jurisdiction.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        storageClass: bucketStorageClassSchema.optional(),
        jurisdiction: bucketJurisdictionSchema.optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.updateR2Bucket(args))),
  );

  server.registerTool(
    "deleteCloudflareR2Bucket",
    {
      description:
        "Delete an empty R2 bucket. Cloudflare requires the bucket to be empty first.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        jurisdiction: bucketJurisdictionSchema.optional(),
      },
    },
    async (args) =>
      createJsonResult(await withClient((client) => client.deleteR2Bucket(args))),
  );

  server.registerTool(
    "getCloudflareR2ManagedDomain",
    {
      description: "Get the current r2.dev managed domain state for a bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.getR2ManagedDomain(args)),
      ),
  );

  server.registerTool(
    "updateCloudflareR2ManagedDomain",
    {
      description: "Enable or disable the managed r2.dev domain for a bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        enabled: z.boolean(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.updateR2ManagedDomain(args)),
      ),
  );

  server.registerTool(
    "listCloudflareR2CustomDomains",
    {
      description: "List custom domains attached to an R2 bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.listR2CustomDomains(args)),
      ),
  );

  server.registerTool(
    "getCloudflareR2CustomDomain",
    {
      description: "Get one R2 bucket custom domain.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        domain: z.string().min(1),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.getR2CustomDomain(args)),
      ),
  );

  server.registerTool(
    "createCloudflareR2CustomDomain",
    {
      description: "Attach a custom domain to an R2 bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        domain: z.string().min(1),
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
        enabled: z.boolean().optional(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.createR2CustomDomain(args)),
      ),
  );

  server.registerTool(
    "updateCloudflareR2CustomDomain",
    {
      description: "Update custom domain settings for an R2 bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        domain: z.string().min(1),
        enabled: z.boolean().optional(),
        minTls: minTlsSchema.optional(),
        zoneId: z.string().min(1).optional(),
        zoneName: z.string().min(1).optional(),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.updateR2CustomDomain(args)),
      ),
  );

  server.registerTool(
    "deleteCloudflareR2CustomDomain",
    {
      description: "Remove a custom domain from an R2 bucket.",
      inputSchema: {
        accountId: z.string().min(1).optional(),
        accountName: z.string().min(1).optional(),
        bucketName: z.string().min(3),
        domain: z.string().min(1),
      },
    },
    async (args) =>
      createJsonResult(
        await withClient((client) => client.deleteR2CustomDomain(args)),
      ),
  );

  return server;
};

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP_TEXT);
  process.exit(0);
}

if (args.includes("--connect")) {
  const result = await runCloudflareBrowserAuthFlow();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (args.includes("--auth-status")) {
  process.stdout.write(`${JSON.stringify(getCloudflareAuthStatus(), null, 2)}\n`);
  process.exit(0);
}

if (args.includes("--test-connection")) {
  const client = createCloudflareClient();
  const result = await client.validateToken();
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        tokenSource: client.auth.source,
        defaultAccountId: client.auth.defaultAccountId,
        defaultZoneId: client.auth.defaultZoneId,
        validation: result,
      },
      null,
      2,
    )}\n`,
  );
  process.exit(0);
}

const transport = new StdioServerTransport();
await createServer().connect(transport);
