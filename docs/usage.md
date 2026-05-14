# Usage

Agentic Devtools is primarily an MCP server package.

The default user should configure their agent host to run a specific tool with
`npx`. They do not need to add Agentic Devtools to their application
dependencies.

Run guided setup once if you want credentials stored locally instead of inline
in MCP host config:

```bash
npx -y @vucinatim/agentic-devtools connect railway
npx -y @vucinatim/agentic-devtools connect namecheap
npx -y @vucinatim/agentic-devtools connect npm
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
operations require authentication.

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
- `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN` for account-scoped inspection
- `RAILWAY_PROJECT_ID` as an optional default project id

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
- `NPM_TOKEN`
- `NODE_AUTH_TOKEN`
- `.npmrc` auth token resolution
- `NPM_CONFIG_REGISTRY` for registry override

For publishing, prefer GitHub Actions Trusted Publishing. Local publishing is
available through the npm MCP client but defaults to dry-run and requires an
explicit confirmation string for real publishes.

## Usage Philosophy

This package should feel like a focused tool belt for agents:

- MCP execution via `npx` is the normal path
- global CLI is a convenience path
- project dependency usage is for custom builders
- host adapters should stay thin and point back to the same package runtime
