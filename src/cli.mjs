#!/usr/bin/env node

import { printJson, wrapToolHandler } from "./core/result.mjs";
import { getTool, listTools } from "./core/tool-registry.mjs";

const usage = () => `Usage:
  agentic-devtools tools
  agentic-devtools railway <command>
  agentic-devtools mcp <cloudflare|namecheap|railway|npm|axiom>
  agentic-devtools connect <cloudflare|namecheap|railway|npm|axiom>
  agentic-devtools bootstrap <cloudflare|railway>    (save global bootstrap token)
  agentic-devtools list-permission-groups cloudflare [filter]
                                                     (lists Cloudflare's current permission catalog)
  agentic-devtools list-accounts cloudflare          (uses cloudflare bootstrap; lists accessible accounts)
  agentic-devtools list-workspaces railway           (uses railway bootstrap; lists workspaces)
  agentic-devtools list-projects railway             [--workspace-id <id>]
  agentic-devtools mint-working cloudflare           --account-id <id> [--to <path>]
                                                     (uses bootstrap to mint account-scoped working token)
  agentic-devtools mint-project-token railway        --project-id <id> [--environment-id <id>] [--to <path>]
                                                     (uses bootstrap to mint project-scoped working token)
  agentic-devtools setup-publishing npm
  agentic-devtools disconnect <cloudflare|namecheap|railway|npm|axiom>
  agentic-devtools auth-status <cloudflare|namecheap|railway|npm|axiom>
  agentic-devtools test-connection <cloudflare|namecheap|railway|npm|axiom>

Environment:
  Cloudflare: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_ZONE_ID, CLOUDFLARE_API_BASE_URL
              CLOUDFLARE_BOOTSTRAP_TOKEN, CLOUDFLARE_BOOTSTRAP_CONFIG_PATH
  Namecheap: NAMECHEAP_API_USER, NAMECHEAP_API_KEY, NAMECHEAP_USERNAME, NAMECHEAP_CLIENT_IP
  Railway:   RAILWAY_PROJECT_TOKEN or RAILWAY_API_TOKEN / RAILWAY_TOKEN
  npm:       NPM_TOKEN or NODE_AUTH_TOKEN
  Axiom:     AXIOM_TOKEN, AXIOM_DATASET, AXIOM_API_BASE_URL, AXIOM_AUTH_CONFIG_PATH, AXIOM_ORG_ID
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
	const { mapRailwayError } = await import("./tools/railway/error-mapper.mjs");
	// Wrap with the same structured-error contract the MCP + other provider CLIs
	// use, so `bun zero railway <op>` failures carry { error, code, remediation }
	// instead of a raw stack trace.
	const wrapped = wrapToolHandler(() => runRailwayCli(args.slice(1)), {
		mapError: mapRailwayError,
	});
	const result = await wrapped();
	const value = result.structuredContent;
	if (value && typeof value === "object" && "__usage" in value) {
		process.stdout.write(value.__usage);
		process.exit(0);
	}
	printJson(value);
	process.exit(result.isError ? 1 : 0);
}

if (args[0] === "axiom") {
	// Operational CLI surface for Axiom (queries, datasets, dashboards).
	// runAxiomCli prints JSON + calls process.exit itself (shared cli-runner).
	const { runAxiomCli } = await import("./tools/axiom/cli.mjs");
	await runAxiomCli(args.slice(1));
	process.exit(0);
}

if (args[0] === "cloudflare") {
	// Operational CLI surface for Cloudflare (DNS, R2, tunnels).
	const { runCloudflareCli } = await import("./tools/cloudflare/cli.mjs");
	await runCloudflareCli(args.slice(1));
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
		const { getCloudflareAuthStatus } = await import(
			"./tools/cloudflare/auth.mjs"
		);
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
	if (toolName === "axiom") {
		const { getAxiomAuthStatus } = await import("./tools/axiom/auth.mjs");
		printJson(getAxiomAuthStatus());
		process.exit(0);
	}
	throw new Error(
		"auth-status expects one of: cloudflare, namecheap, railway, npm, axiom",
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
	if (toolName === "axiom") {
		const { runAxiomBrowserAuthFlow } = await import("./tools/axiom/auth.mjs");
		process.stderr.write("Opening Axiom browser setup flow...\n");
		printJson(await runAxiomBrowserAuthFlow());
		process.exit(0);
	}
	throw new Error(
		"connect expects one of: cloudflare, namecheap, railway, npm, axiom",
	);
}

// ---- bootstrap (cloudflare-only currently) ----------------------------------
// Save a user-level bootstrap token used ONLY for minting account-scoped
// working tokens. One per machine. Stored at
// ~/.config/agentic-devtools/cloudflare-bootstrap.json (or override via env).
if (args[0] === "bootstrap") {
	const toolName = args[1];
	if (toolName === "cloudflare") {
		const { runCloudflareBootstrapFlow } = await import(
			"./tools/cloudflare/auth.mjs"
		);
		process.stderr.write(
			"Opening Cloudflare bootstrap setup flow (one-time per machine)...\n",
		);
		printJson(await runCloudflareBootstrapFlow());
		process.exit(0);
	}
	if (toolName === "railway") {
		const { runRailwayBootstrapFlow } = await import(
			"./tools/railway/auth.mjs"
		);
		process.stderr.write(
			"Opening Railway bootstrap setup flow (one-time per machine)...\n",
		);
		printJson(await runRailwayBootstrapFlow());
		process.exit(0);
	}
	throw new Error("bootstrap expects: cloudflare | railway");
}

// ---- list-permission-groups (cloudflare diagnostic) ------------------------
// Useful when permission-group IDs drift (which they do — see 0.1.9 → 0.1.10).
// Lists Cloudflare's current catalog so we can audit our resolver fallbacks.
if (args[0] === "list-permission-groups") {
	const toolName = args[1];
	if (toolName === "cloudflare") {
		const { getCloudflarePermissionGroups } = await import(
			"./core/permission-group-resolver.mjs"
		);
		const { getCloudflareBootstrapToken } = await import(
			"./tools/cloudflare/auth.mjs"
		);
		const bootstrap = getCloudflareBootstrapToken();
		if (!bootstrap.token) {
			throw new Error(
				"list-permission-groups cloudflare requires a bootstrap token. Run `agentic-devtools bootstrap cloudflare` first.",
			);
		}
		const groups = await getCloudflarePermissionGroups({
			authToken: bootstrap.token,
		});
		const rest = args.slice(2);
		const filter = rest.find((a) => !a.startsWith("--"));
		const filtered = filter
			? groups.filter((g) =>
					String(g.name).toLowerCase().includes(filter.toLowerCase()),
				)
			: groups;
		printJson({
			total: groups.length,
			shown: filtered.length,
			filter: filter ?? null,
			groups: filtered,
		});
		process.exit(0);
	}
	throw new Error("list-permission-groups expects: cloudflare");
}

// ---- list-accounts (uses bootstrap) -----------------------------------------
if (args[0] === "list-accounts") {
	const toolName = args[1];
	if (toolName === "cloudflare") {
		const { createCloudflareBootstrapClient } = await import(
			"./tools/cloudflare/client.mjs"
		);
		const client = createCloudflareBootstrapClient();
		printJson(await client.listAccessibleAccounts());
		process.exit(0);
	}
	throw new Error("list-accounts expects: cloudflare");
}

// ---- list-workspaces (railway bootstrap) -----------------------------------
if (args[0] === "list-workspaces") {
	const toolName = args[1];
	if (toolName === "railway") {
		const { createRailwayBootstrapClient } = await import(
			"./tools/railway/client.mjs"
		);
		const client = createRailwayBootstrapClient();
		printJson(await client.listWorkspaces());
		process.exit(0);
	}
	throw new Error("list-workspaces expects: railway");
}

// ---- list-projects (railway bootstrap) -------------------------------------
if (args[0] === "list-projects") {
	const toolName = args[1];
	if (toolName === "railway") {
		const { createRailwayBootstrapClient } = await import(
			"./tools/railway/client.mjs"
		);
		const rest = args.slice(2);
		const getFlag = (n) => {
			const i = rest.indexOf(`--${n}`);
			return i !== -1 ? rest[i + 1] : null;
		};
		const workspaceId = getFlag("workspace-id");
		const client = createRailwayBootstrapClient();
		printJson(await client.listProjects({ workspaceId }));
		process.exit(0);
	}
	throw new Error("list-projects expects: railway");
}

// ---- mint-project-token (railway) ------------------------------------------
if (args[0] === "mint-project-token") {
	const toolName = args[1];
	if (toolName === "railway") {
		const { createRailwayBootstrapClient } = await import(
			"./tools/railway/client.mjs"
		);
		const { saveRailwayAuthConfig } = await import("./tools/railway/auth.mjs");

		const rest = args.slice(2);
		const getFlag = (n) => {
			const i = rest.indexOf(`--${n}`);
			return i !== -1 ? rest[i + 1] : null;
		};
		const projectId = getFlag("project-id");
		const environmentId = getFlag("environment-id");
		const tokenName = getFlag("token-name");
		const toPath = getFlag("to");

		if (!projectId) {
			throw new Error(
				"mint-project-token railway requires --project-id <id>. Run list-projects railway first.",
			);
		}

		const client = createRailwayBootstrapClient();
		const minted = await client.mintProjectToken({
			projectId,
			environmentId,
			name: tokenName,
		});

		if (toPath) {
			const original = process.env.RAILWAY_AUTH_CONFIG_PATH;
			process.env.RAILWAY_AUTH_CONFIG_PATH = toPath;
			try {
				await saveRailwayAuthConfig({
					token: minted.tokenValue,
					kind: "project",
					defaultProjectId: minted.projectId,
				});
			} finally {
				if (original === undefined) {
					delete process.env.RAILWAY_AUTH_CONFIG_PATH;
				} else {
					process.env.RAILWAY_AUTH_CONFIG_PATH = original;
				}
			}
		}

		printJson({
			projectId: minted.projectId,
			environmentId: minted.environmentId,
			name: minted.name,
			written_to: toPath ?? null,
			...(toPath ? {} : { tokenValue: minted.tokenValue }),
		});
		process.exit(0);
	}
	throw new Error("mint-project-token expects: railway");
}

// ---- mint-working (uses bootstrap → writes working token) ------------------
if (args[0] === "mint-working") {
	const toolName = args[1];
	if (toolName === "cloudflare") {
		const { createCloudflareBootstrapClient } = await import(
			"./tools/cloudflare/client.mjs"
		);
		const { saveCloudflareAuthConfig } = await import(
			"./tools/cloudflare/auth.mjs"
		);

		// Simple flag parser: --account-id <id>, --account-name <name>, --to <path>
		const rest = args.slice(2);
		const getFlag = (name) => {
			const i = rest.indexOf(`--${name}`);
			return i !== -1 ? rest[i + 1] : null;
		};

		const accountId = getFlag("account-id");
		const accountName = getFlag("account-name");
		const toPath = getFlag("to");
		const tokenName = getFlag("token-name");

		if (!accountId) {
			throw new Error(
				"mint-working cloudflare requires --account-id <id>. Run list-accounts cloudflare first.",
			);
		}

		const client = createCloudflareBootstrapClient();
		const minted = await client.mintWorkingToken({
			accountId,
			accountName,
			tokenName,
		});

		// If --to was supplied, write a working-token config file at that path so
		// an MCP server reading CLOUDFLARE_AUTH_CONFIG_PATH can pick it up.
		if (toPath) {
			// The auth helper expects to write at CLOUDFLARE_AUTH_CONFIG_PATH; we
			// bend it by setting that env var locally for this save.
			const original = process.env.CLOUDFLARE_AUTH_CONFIG_PATH;
			process.env.CLOUDFLARE_AUTH_CONFIG_PATH = toPath;
			try {
				await saveCloudflareAuthConfig({
					token: minted.tokenValue,
					defaultAccountId: minted.accountId,
				});
			} finally {
				if (original === undefined) {
					delete process.env.CLOUDFLARE_AUTH_CONFIG_PATH;
				} else {
					process.env.CLOUDFLARE_AUTH_CONFIG_PATH = original;
				}
			}
		}

		// Print everything EXCEPT the raw token value to stdout. If --to was set,
		// the token is on disk; otherwise the caller is responsible for capturing
		// it from the JSON output.
		printJson({
			tokenId: minted.tokenId,
			tokenName: minted.tokenName,
			accountId: minted.accountId,
			accountName: minted.accountName,
			permission_group_ids: minted.permission_group_ids,
			written_to: toPath ?? null,
			// Only include raw value when NOT written to disk (so caller can read it).
			...(toPath ? {} : { tokenValue: minted.tokenValue }),
		});
		process.exit(0);
	}
	throw new Error("mint-working expects: cloudflare");
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
		const { disconnectCloudflare } = await import(
			"./tools/cloudflare/auth.mjs"
		);
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
	if (toolName === "axiom") {
		const { disconnectAxiom } = await import("./tools/axiom/auth.mjs");
		printJson(await disconnectAxiom());
		process.exit(0);
	}
	throw new Error(
		"disconnect expects one of: cloudflare, namecheap, railway, npm, axiom",
	);
}

if (args[0] === "test-connection") {
	const toolName = args[1];
	if (toolName === "cloudflare") {
		const { createCloudflareClient } = await import(
			"./tools/cloudflare/client.mjs"
		);
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
	if (toolName === "axiom") {
		const { createAxiomClient } = await import("./tools/axiom/client.mjs");
		const client = createAxiomClient();
		const result = await client.validateToken();
		printJson({
			ok: result.ok,
			tokenSource: client.auth.source,
			defaultDataset: client.auth.defaultDataset,
			result,
		});
		process.exit(0);
	}
	throw new Error(
		"test-connection expects one of: cloudflare, namecheap, railway, npm, axiom",
	);
}

throw new Error(`Unknown command "${args[0]}".\n\n${usage()}`);
