# Usage

Agentic Devtools is primarily an MCP server package.

The default user should configure their agent host to run a specific tool with
`npx`. They do not need to add Agentic Devtools to their application
dependencies.

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

## Secondary: Global CLI

Install globally only if you want repeated terminal access without `npx`:

```bash
npm install -g @vucinatim/agentic-devtools
agentic-devtools tools
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
```

## Auth

Railway supports:

- `RAILWAY_PROJECT_TOKEN` for project-scoped inspection
- `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN` for account-scoped inspection
- `RAILWAY_PROJECT_ID` as an optional default project id

Namecheap supports:

- `NAMECHEAP_API_USER`
- `NAMECHEAP_API_KEY`
- `NAMECHEAP_USERNAME`
- `NAMECHEAP_CLIENT_IP`
- `NAMECHEAP_API_SANDBOX=1` for sandbox usage
- `NAMECHEAP_API_BASE_URL` for an explicit endpoint override

## Usage Philosophy

This package should feel like a focused tool belt for agents:

- MCP execution via `npx` is the normal path
- global CLI is a convenience path
- project dependency usage is for custom builders
- host adapters should stay thin and point back to the same package runtime
