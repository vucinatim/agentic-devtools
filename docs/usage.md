# Usage

Agentic Devtools is primarily an MCP server package.

The default user should configure their agent host to run a specific tool with
`npx`. They do not need to add Agentic Devtools to their application
dependencies.

Treat `npx` as the canonical path. Global install is optional shell
convenience, not the primary contract.

Run guided setup once if you want credentials stored locally instead of inline
in MCP host config:

```bash
npx -y @vucinatim/agentic-devtools connect railway
npx -y @vucinatim/agentic-devtools connect namecheap
npx -y @vucinatim/agentic-devtools connect npm
npx -y @vucinatim/agentic-devtools setup-publishing npm
```

## Primary: MCP Host With `npx`

Use this for Codex, Claude, or any MCP-compatible host.

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
- `RAILWAY_PROJECT_ID` as an optional default project id

If `connect railway` has already saved a token locally, omit the `env` block.

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

If `connect namecheap` has already saved credentials locally, omit the `env`
block.

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

Use `connect npm` for guided token setup when package inspection or token
operations require authentication. Use `setup-publishing npm` when the package
needs to attach GitHub Actions Trusted Publishing through npm's official trust
setup flow.

## Secondary: Global CLI

Install globally only if you want repeated terminal access without `npx`:

```bash
npm install -g @vucinatim/agentic-devtools
agentic-devtools tools
agentic-devtools connect railway
agentic-devtools connect npm
agentic-devtools auth-status railway
agentic-devtools test-connection railway
```

If the command is not found after `npm install -g`, your shell is not exposing
npm's global bin directory. This is common with version managers such as `fnm`
or `nvm`.

Check:

```bash
npm prefix -g
```

Then ensure `<that-prefix>/bin` is on your `PATH`, or skip global install and
use:

```bash
npx -y @vucinatim/agentic-devtools tools
```

## Tertiary: Project Dependency

Install into a project only when you want to build custom automation using the
service clients:

```bash
npm install @vucinatim/agentic-devtools
```

```js
import { createRailwayClient } from "@vucinatim/agentic-devtools";
import { createNamecheapClient } from "@vucinatim/agentic-devtools";
import { createNpmClient } from "@vucinatim/agentic-devtools";
```

## Auth

Railway supports:

- guided local setup through `agentic-devtools connect railway`
- `RAILWAY_PROJECT_TOKEN` for project-scoped inspection
- `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN` for account tokens and workspace tokens
- `RAILWAY_PROJECT_ID` as an optional default project id
- `RAILWAY_API_ENDPOINT` for endpoint override

Railway token guidance:

- account token: broadest scope across your resources and workspaces
- workspace token: scoped to one workspace, still passed as bearer auth through
  `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN`
- project token: scoped to one environment, passed through
  `RAILWAY_PROJECT_TOKEN`

Validation behavior:

- project tokens are validated through the `projectToken` query
- account and workspace tokens are validated through project listing
- identity-style `me` queries are not treated as the compatibility baseline for
  all bearer tokens

Namecheap supports:

- guided local setup through `agentic-devtools connect namecheap`
- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME`
- `NAMECHEAP_CLIENT_IP`
- `NAMECHEAP_API_SANDBOX=1` for sandbox usage
- `NAMECHEAP_API_BASE_URL` for an explicit endpoint override

npm supports:

- guided local setup through `agentic-devtools connect npm`
- guided GitHub Actions Trusted Publishing setup through `agentic-devtools setup-publishing npm`
- `NPM_TOKEN`
- `NODE_AUTH_TOKEN`
- `.npmrc` auth token resolution
- `NPM_CONFIG_REGISTRY` for registry override

npm publishing guidance:

- prefer GitHub Actions Trusted Publishing over long-lived write tokens
- npm currently documents Trusted Publishing for GitHub-hosted runners, not
  self-hosted GitHub Actions runners
- npm currently documents Node `22.14.0+` and npm CLI `11.5.1+` for Trusted
  Publishing
- provenance attestations are generated automatically for public packages
  published from public repositories through supported Trusted Publishing flows

For publishing, prefer GitHub Actions Trusted Publishing. Local publishing is
available through the npm MCP client but defaults to dry-run and requires an
explicit confirmation string for real publishes.

## Usage Philosophy

This package should feel like a focused tool belt for agents:

- MCP execution via `npx` is the normal path
- global CLI is a convenience path
- project dependency usage is for custom builders
- host adapters should stay thin and point back to the same package runtime
