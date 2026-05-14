# Agentic Devtools

Reusable developer tools for AI agents.

Agentic Devtools is an MCP-first open-source package for developer platforms
such as Railway, Namecheap, and npm. It is meant to be run directly by MCP hosts with
`npx`, while still exposing package imports for custom automation.

`npx` is the canonical runtime path. Global install is optional terminal
convenience only.

Most users should not install this into their app. Point your agent host at the
tool you need:

```bash
npx -y @vucinatim/agentic-devtools mcp railway
npx -y @vucinatim/agentic-devtools mcp namecheap
npx -y @vucinatim/agentic-devtools mcp npm
```

Run the guided setup once if you do not want to put tokens in MCP host config:

```bash
npx -y @vucinatim/agentic-devtools connect railway
npx -y @vucinatim/agentic-devtools connect namecheap
npx -y @vucinatim/agentic-devtools connect npm
```

npm publishing setup can also be driven through the package:

```bash
npx -y @vucinatim/agentic-devtools setup-publishing npm
```

Start here:

- [docs/architecture.md](docs/architecture.md)
- [docs/usage.md](docs/usage.md)
- [docs/auth-and-setup-guidelines.md](docs/auth-and-setup-guidelines.md)
- [docs/open-source-readiness.md](docs/open-source-readiness.md)
- [docs/publishing.md](docs/publishing.md)
- [docs/migration-plan.md](docs/migration-plan.md)
- [docs/testing.md](docs/testing.md)

Project docs:

- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)
- [LICENSE](LICENSE)

## Repository Shape

- `src/core/`
  Shared CLI, registry, and result helpers.
- `src/tools/<tool-name>/`
  Service clients and MCP server entrypoints.
- `adapters/codex/<tool-name>/`
  Codex-specific plugin packaging and marketplace-facing metadata.
- `adapters/claude/<tool-name>/`
  Claude-facing adapter notes or future wrapper code.
- `tests/tools/<tool-name>/`
  Integration and protocol tests for each tool.
- `.agents/plugins/marketplace.json`
  Local Codex marketplace catalog for the Codex adapters in this repo.

The package publishes as `@vucinatim/agentic-devtools` and exposes one CLI:
`agentic-devtools`.

## Usage

### MCP Host Via `npx`

This is the primary usage path.

Railway:

```json
{
  "mcpServers": {
    "railway": {
      "command": "npx",
      "args": ["-y", "@vucinatim/agentic-devtools", "mcp", "railway"],
      "env": {
        "RAILWAY_API_TOKEN": "..."
      }
    }
  }
}
```

Use:

- `RAILWAY_API_TOKEN` for Railway account tokens and workspace tokens
- `RAILWAY_PROJECT_TOKEN` for Railway project tokens
- `RAILWAY_PROJECT_ID` as an optional default project id for account/workspace
  token flows

After `connect railway`, the same server config can omit `env` because the
stored token is resolved from `~/.config/agentic-devtools/railway.json`.

Namecheap:

```json
{
  "mcpServers": {
    "namecheap": {
      "command": "npx",
      "args": ["-y", "@vucinatim/agentic-devtools", "mcp", "namecheap"],
      "env": {
        "NAMECHEAP_API_USER": "...",
        "NAMECHEAP_API_KEY": "...",
        "NAMECHEAP_USERNAME": "...",
        "NAMECHEAP_CLIENT_IP": "..."
      }
    }
  }
}
```

After `connect namecheap`, the same server config can omit `env` because
credentials are resolved from `~/.config/agentic-devtools/namecheap.json`.

npm:

```json
{
  "mcpServers": {
    "npm": {
      "command": "npx",
      "args": ["-y", "@vucinatim/agentic-devtools", "mcp", "npm"]
    }
  }
}
```

Use `connect npm` for guided token setup. For real package releases, prefer
GitHub Actions Trusted Publishing over local write tokens. Use
`setup-publishing npm` to run npm's official Trusted Publishing setup command
through the package.

### Railway Coverage

The Railway tool now targets parity with Railway's documented public API for:

- projects and project members
- environments
- services and service instances
- deployments
- variables
- Railway-managed and custom domains
- volumes

This does not currently claim parity for undocumented dashboard-only concepts
such as canvas grouping internals.

Trusted Publishing notes:

- npm currently documents Trusted Publishing for GitHub-hosted GitHub Actions,
  GitLab.com shared runners, and CircleCI cloud
- npm documents a minimum of Node `22.14.0` and npm CLI `11.5.1` for Trusted
  Publishing
- each npm package currently has one Trusted Publisher connection at a time

### Team Or Repo Install

If a team wants one pinned version available to every developer in the repo,
install Agentic Devtools as a dev dependency and commit the scripts or MCP
config.

Install:

```bash
npm install -D @vucinatim/agentic-devtools
```

Example `package.json` scripts:

```json
{
  "scripts": {
    "agentic:tools": "agentic-devtools tools",
    "agentic:railway": "agentic-devtools mcp railway",
    "agentic:namecheap": "agentic-devtools mcp namecheap",
    "agentic:npm": "agentic-devtools mcp npm",
    "agentic:connect:railway": "agentic-devtools connect railway",
    "agentic:connect:namecheap": "agentic-devtools connect namecheap",
    "agentic:connect:npm": "agentic-devtools connect npm"
  }
}
```

Example checked-in MCP config using the repo-local installed version:

```json
{
  "mcpServers": {
    "railway": {
      "command": "npx",
      "args": ["agentic-devtools", "mcp", "railway"]
    },
    "namecheap": {
      "command": "npx",
      "args": ["agentic-devtools", "mcp", "namecheap"]
    },
    "npm": {
      "command": "npx",
      "args": ["agentic-devtools", "mcp", "npm"]
    }
  }
}
```

Each developer still runs their own local auth setup:

```bash
npm run agentic:connect:railway
npm run agentic:connect:namecheap
npm run agentic:connect:npm
```

This keeps:

- package version and MCP config shared in the repo
- credentials local to each developer under `~/.config/agentic-devtools/`
- global install optional instead of required

### Global CLI

Useful if you use the tools often from a terminal:

```bash
npm install -g @vucinatim/agentic-devtools
agentic-devtools tools
agentic-devtools connect railway
agentic-devtools auth-status railway
agentic-devtools mcp railway
```

If `agentic-devtools` is not found after global install, your shell is not
exposing npm's global bin path. That is a shell setup issue, most commonly with
Node version managers such as `fnm` or `nvm`, not a package runtime issue.

Check:

```bash
npm prefix -g
```

Then make sure `<that-prefix>/bin` is on your `PATH`, or just use the canonical
no-install path:

```bash
npx -y @vucinatim/agentic-devtools tools
```

### Project Dependency

Use this only when building your own automation on top of the service clients:

```bash
npm install @vucinatim/agentic-devtools
```

```js
import { createRailwayClient } from "@vucinatim/agentic-devtools";
import { createNamecheapClient } from "@vucinatim/agentic-devtools";
import { createNpmClient } from "@vucinatim/agentic-devtools";
```

## Design rule

Keep the integration logic host-agnostic:

1. build the service client and shared behavior in `src/`
2. expose MCP from the same shared layer
3. keep Codex and Claude wrappers thin and replaceable

## Current plugins

- `namecheap`
- `railway`
- `npm`

## Development

Current validation commands:

```bash
npm run build
npm test
npm run test:published -- --version <published-version>
npm run test:namecheap
npm run test:railway
npm run coverage
npm run check
```

## Local Adapter Development

Local Codex adapter entries point to:

- `./adapters/codex/namecheap`
- `./adapters/codex/railway`

The shared MCP server implementations live at:

- `src/tools/namecheap/mcp.mjs`
- `src/tools/railway/mcp.mjs`

Local CLI examples:

```bash
node src/cli.mjs tools
node src/cli.mjs mcp railway
node src/cli.mjs auth-status namecheap
```

## Publishing direction

Publishing should use GitHub Actions and npm Trusted Publishing via OIDC. This
avoids long-lived npm tokens and gives the public package provenance
attestations.

See [docs/publishing.md](docs/publishing.md).
