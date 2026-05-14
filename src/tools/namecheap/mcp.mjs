#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  AUTH_CONFIG_PATH,
  clearStoredAuthConfig,
  getAuthStatus,
  runBrowserAuthFlow,
} from "./auth.mjs";
import { createResolvedNamecheapClient } from "./client.mjs";

const HELP_TEXT = `Usage: node ./src/namecheap-mcp.mjs [--connect] [--auth-status] [--test-connection]

Namecheap MCP server

Optional environment variables:
  NAMECHEAP_API_USER
  NAMECHEAP_API_KEY
  NAMECHEAP_USERNAME
  NAMECHEAP_CLIENT_IP
  NAMECHEAP_API_BASE_URL
  NAMECHEAP_API_SANDBOX=1

If env vars are not provided, use the connectNamecheap tool to open the browser-based setup flow and save local plugin credentials.
`;

const recordSchema = z.object({
  name: z.string().min(1),
  type: z.enum([
    "A",
    "AAAA",
    "ALIAS",
    "CAA",
    "CNAME",
    "FRAME",
    "MX",
    "MXE",
    "NS",
    "TXT",
    "URL",
    "URL301",
  ]),
  address: z.string().min(1),
  ttl: z.number().int().min(60).max(60000).optional(),
  mxPref: z.number().int().min(0).max(65535).optional(),
  emailType: z.enum(["FWD", "MX", "MXE", "OX"]).optional(),
  flag: z.number().int().min(0).max(255).optional(),
  tag: z.enum(["issue", "issuewild", "iodef"]).optional(),
});

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
      name: "namecheap",
      version: "0.1.0",
    },
    {
      instructions:
        "Use these tools for Namecheap-managed domains and DNS. Prefer getDomainDns before mutating records because Namecheap setHosts replaces the full record set. Namecheap auth is API-key based, not OAuth.",
    },
  );

  const withClient = async (callback) => {
    const client = await createResolvedNamecheapClient();
    return callback(client);
  };

  server.registerTool(
    "getAuthStatus",
    {
      description:
        "Show whether Namecheap credentials are configured through environment variables or the local plugin auth file.",
    },
    async () => createToolResult(await getAuthStatus()),
  );

  server.registerTool(
    "connectNamecheap",
    {
      description:
        "Open a browser-based setup flow for Namecheap API credentials. This stores credentials locally in the plugin auth file because Namecheap uses API keys and IP whitelisting rather than OAuth tokens.",
      inputSchema: {
        sandbox: z.boolean().optional(),
      },
    },
    async ({ sandbox }) =>
      createToolResult({
        ...(await runBrowserAuthFlow({
          defaultSandbox: sandbox ?? true,
        })),
        configPath: AUTH_CONFIG_PATH,
      }),
  );

  server.registerTool(
    "disconnectNamecheap",
    {
      description:
        "Remove locally stored Namecheap credentials from the plugin auth file.",
    },
    async () => {
      await clearStoredAuthConfig();
      return createToolResult({
        disconnected: true,
        configPath: AUTH_CONFIG_PATH,
      });
    },
  );

  server.registerTool(
    "testNamecheapConnection",
    {
      description:
        "Verify that the configured Namecheap credentials can successfully call the API.",
    },
    async () =>
      createToolResult(
        await withClient(async (client) => {
          const result = await client.listDomains({ page: 1, pageSize: 1 });
          return {
            ok: true,
            domainCount: result.paging.totalItems,
            sampleDomains: result.domains.slice(0, 1).map((domain) => domain.name),
            baseUrl: client.baseUrl,
          };
        }),
      ),
  );

  server.registerTool(
    "listDomains",
    {
      description:
        "List domains in the configured Namecheap account. Use searchTerm to narrow results.",
      inputSchema: {
        searchTerm: z.string().optional(),
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        listType: z.enum(["ALL", "EXPIRING", "EXPIRED"]).optional(),
        sortBy: z
          .enum([
            "NAME",
            "NAME_DESC",
            "EXPIREDATE",
            "EXPIREDATE_DESC",
            "CREATEDATE",
            "CREATEDATE_DESC",
          ])
          .optional(),
      },
    },
    async (args) =>
      createToolResult(await withClient((client) => client.listDomains(args))),
  );

  server.registerTool(
    "getDomainDns",
    {
      description:
        "Get Namecheap DNS status, nameservers, and host records for a registered domain.",
      inputSchema: {
        domain: z.string().min(1),
      },
    },
    async ({ domain }) =>
      createToolResult(await withClient((client) => client.getDomainDns(domain))),
  );

  server.registerTool(
    "replaceDomainDns",
    {
      description:
        "Replace the full DNS host record set for a Namecheap-managed domain. This is destructive and should only be used with the complete intended record list.",
      inputSchema: {
        domain: z.string().min(1),
        records: z.array(recordSchema).min(1),
        emailType: z.enum(["FWD", "MX", "MXE", "OX"]).optional(),
      },
    },
    async ({ domain, records, emailType }) =>
      createToolResult(
        await withClient((client) =>
          client.replaceDomainDns({ domain, records, emailType }),
        ),
      ),
  );

  server.registerTool(
    "addDomainDnsRecord",
    {
      description:
        "Add a single DNS record while preserving the existing Namecheap DNS zone. No change is made if an identical record already exists.",
      inputSchema: {
        domain: z.string().min(1),
        record: recordSchema,
      },
    },
    async ({ domain, record }) =>
      createToolResult(
        await withClient((client) =>
          client.addDomainDnsRecord({ domain, record }),
        ),
      ),
  );

  server.registerTool(
    "removeDomainDnsRecord",
    {
      description:
        "Remove a single DNS record by exact match while preserving the rest of the zone.",
      inputSchema: {
        domain: z.string().min(1),
        record: recordSchema,
      },
    },
    async ({ domain, record }) =>
      createToolResult(
        await withClient((client) =>
          client.removeDomainDnsRecord({ domain, record }),
        ),
      ),
  );

  server.registerTool(
    "updateDomainDnsRecord",
    {
      description:
        "Update exactly one DNS record by explicit match while preserving the rest of the zone. Fails if zero or multiple records match.",
      inputSchema: {
        domain: z.string().min(1),
        matchRecord: recordSchema,
        newRecord: recordSchema,
      },
    },
    async ({ domain, matchRecord, newRecord }) =>
      createToolResult(
        await withClient((client) =>
          client.updateDomainDnsRecord({ domain, matchRecord, newRecord }),
        ),
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
  process.stdout.write(`${JSON.stringify(await getAuthStatus(), null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--connect")) {
  process.stdout.write("Opening Namecheap browser setup flow...\n");
  const result = await runBrowserAuthFlow({ defaultSandbox: true });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(0);
}

if (argv.includes("--test-connection")) {
  const client = await createResolvedNamecheapClient();
  const result = await client.listDomains({ page: 1, pageSize: 1 });
  process.stdout.write(
    `${JSON.stringify(
      {
        ok: true,
        domainCount: result.paging.totalItems,
        sampleDomains: result.domains.slice(0, 1).map((domain) => domain.name),
        baseUrl: client.baseUrl,
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
