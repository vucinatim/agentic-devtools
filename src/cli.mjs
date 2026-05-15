#!/usr/bin/env node

import { printJson } from "./core/result.mjs";
import { getTool, listTools } from "./core/tool-registry.mjs";

const usage = () => `Usage:
  agentic-devtools tools
  agentic-devtools railway <command>
  agentic-devtools mcp <cloudflare|namecheap|railway|npm>
  agentic-devtools connect <cloudflare|namecheap|railway|npm>
  agentic-devtools setup-publishing npm
  agentic-devtools disconnect <cloudflare|namecheap|railway|npm>
  agentic-devtools auth-status <cloudflare|namecheap|railway|npm>
  agentic-devtools test-connection <cloudflare|namecheap|railway|npm>

Environment:
  Cloudflare: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_BASE_URL
  Namecheap: NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, NAMECHEAP_CLIENT_IP
  Railway:   RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN / RAILWAY_TOKEN
  npm:       NPM_TOKEN or NODE_AUTH_TOKEN
`;

const args = process.argv.slice(2);

if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  process.stdout.write(usage());
  process.exit(0);
}

if (args[0] === "tools") {
  printJson(listTools());
  process.exit(0);
}

if (args[0] === "railway") {
  const { runRailwayCli } = await import("./tools/railway/cli.mjs");
  const result = await runRailwayCli(args.slice(1));
  if (result && typeof result === "object" && "__usage" in result) {
    process.stdout.write(result.__usage);
  } else {
    printJson(result);
  }
  process.exit(0);
}

if (args[0] === "mcp") {
  const toolName = args[1];
  if (!toolName) {
    throw new Error("Missing tool name for mcp command.");
  }
  const tool = getTool(toolName);
  await import(tool.mcpModule);
  process.exit(0);
}

if (args[0] === "auth-status") {
  const toolName = args[1];
  if (toolName === "cloudflare") {
    const { getCloudflareAuthStatus } = await import("./tools/cloudflare/auth.mjs");
    printJson(getCloudflareAuthStatus());
    process.exit(0);
  }
  if (toolName === "namecheap") {
    const { getAuthStatus } = await import("./tools/namecheap/auth.mjs");
    printJson(await getAuthStatus());
    process.exit(0);
  }
  if (toolName === "railway") {
    const { getRailwayAuthStatus } = await import("./tools/railway/client.mjs");
    printJson(getRailwayAuthStatus());
    process.exit(0);
  }
  if (toolName === "npm") {
    const { getNpmAuthStatus } = await import("./tools/npm/auth.mjs");
    printJson(getNpmAuthStatus());
    process.exit(0);
  }
  throw new Error(
    "auth-status expects one of: cloudflare, namecheap, railway, npm",
  );
}

if (args[0] === "connect") {
  const toolName = args[1];
  if (toolName === "cloudflare") {
    const { runCloudflareBrowserAuthFlow } = await import(
      "./tools/cloudflare/auth.mjs"
    );
    process.stderr.write("Opening Cloudflare browser setup flow...\n");
    printJson(await runCloudflareBrowserAuthFlow());
    process.exit(0);
  }
  if (toolName === "namecheap") {
    const { runBrowserAuthFlow } = await import("./tools/namecheap/auth.mjs");
    process.stderr.write("Opening Namecheap browser setup flow...\n");
    printJson(await runBrowserAuthFlow());
    process.exit(0);
  }
  if (toolName === "railway") {
    const { runRailwayBrowserAuthFlow } = await import(
      "./tools/railway/auth.mjs"
    );
    process.stderr.write("Opening Railway browser setup flow...\n");
    printJson(await runRailwayBrowserAuthFlow());
    process.exit(0);
  }
  if (toolName === "npm") {
    const { runNpmBrowserAuthFlow } = await import("./tools/npm/auth.mjs");
    process.stderr.write("Opening npm browser setup flow...\n");
    printJson(
      await runNpmBrowserAuthFlow({
        onReady: ({ url }) => {
          process.stderr.write(`npm setup URL: ${url}\n`);
        },
      }),
    );
    process.exit(0);
  }
  throw new Error("connect expects one of: cloudflare, namecheap, railway, npm");
}

if (args[0] === "setup-publishing") {
  const toolName = args[1];
  if (toolName === "npm") {
    const { runNpmTrustGithubSetup } = await import(
      "./tools/npm/trust-cli.mjs"
    );
    process.stderr.write(
      "Running npm's official GitHub Trusted Publishing setup flow...\n",
    );
    const result = await runNpmTrustGithubSetup({
      stdio: "inherit",
      loginFirst: true,
    });
    if (!result.ok) {
      process.exit(result.status || 1);
    }
    printJson({
      ok: true,
      command: result.command,
      args: result.args,
      tokenSource: result.tokenSource,
    });
    process.exit(0);
  }
  throw new Error("setup-publishing expects: npm");
}

if (args[0] === "disconnect") {
  const toolName = args[1];
  if (toolName === "cloudflare") {
    const { disconnectCloudflare } = await import("./tools/cloudflare/auth.mjs");
    printJson(await disconnectCloudflare());
    process.exit(0);
  }
  if (toolName === "namecheap") {
    const { disconnectNamecheap } = await import("./tools/namecheap/auth.mjs");
    printJson(await disconnectNamecheap());
    process.exit(0);
  }
  if (toolName === "railway") {
    const { disconnectRailway } = await import("./tools/railway/auth.mjs");
    printJson(await disconnectRailway());
    process.exit(0);
  }
  if (toolName === "npm") {
    const { disconnectNpm } = await import("./tools/npm/auth.mjs");
    printJson(await disconnectNpm());
    process.exit(0);
  }
  throw new Error(
    "disconnect expects one of: cloudflare, namecheap, railway, npm",
  );
}

if (args[0] === "test-connection") {
  const toolName = args[1];
  if (toolName === "cloudflare") {
    const { createCloudflareClient } = await import("./tools/cloudflare/client.mjs");
    const client = createCloudflareClient();
    printJson({
      ok: true,
      tokenSource: client.auth.source,
      defaultAccountId: client.auth.defaultAccountId,
      defaultZoneId: client.auth.defaultZoneId,
      result: await client.validateToken(),
    });
    process.exit(0);
  }
  if (toolName === "namecheap") {
    const { createResolvedNamecheapClient } = await import(
      "./tools/namecheap/client.mjs"
    );
    const client = await createResolvedNamecheapClient();
    const result = await client.listDomains({ page: 1, pageSize: 1 });
    printJson({
      ok: true,
      domainCount: result.paging.totalItems,
      sampleDomains: result.domains.slice(0, 1).map((domain) => domain.name),
      baseUrl: client.baseUrl,
    });
    process.exit(0);
  }
  if (toolName === "railway") {
    const { createRailwayClient } = await import("./tools/railway/client.mjs");
    const client = createRailwayClient();
    const result =
      client.auth.kind === "project"
        ? await client.getProjectTokenContext()
        : await client.validateAccountToken();
    printJson({
      ok: true,
      tokenSource: client.auth.source,
      tokenKind: client.auth.kind,
      result,
    });
    process.exit(0);
  }
  if (toolName === "npm") {
    const { createNpmClient } = await import("./tools/npm/client.mjs");
    const client = createNpmClient();
    printJson({
      ok: true,
      tokenSource: client.auth.source,
      registry: client.registry,
      user: await client.getCurrentUser(),
    });
    process.exit(0);
  }
  throw new Error(
    "test-connection expects one of: cloudflare, namecheap, railway, npm",
  );
}

throw new Error(`Unknown command "${args[0]}".\n\n${usage()}`);
