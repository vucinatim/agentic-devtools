# Agentic Devtools

Reusable developer tools for AI agents.

Agentic Devtools is an MCP-first open-source package for developer platforms
such as Railway and Namecheap. It is meant to be run directly by MCP hosts with
`npx`, while still exposing package imports for custom automation.

Most users should not install this into their app. Point your agent host at the
tool you need:

```bash
npx -y @vucinatim/agentic-devtools mcp railway
npx -y @vucinatim/agentic-devtools mcp namecheap
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

### Global CLI

Useful if you use the tools often from a terminal:

```bash
npm install -g @vucinatim/agentic-devtools
agentic-devtools tools
agentic-devtools auth-status railway
agentic-devtools mcp railway
```

### Project Dependency

Use this only when building your own automation on top of the service clients:

```bash
npm install @vucinatim/agentic-devtools
```

```js
import { createRailwayClient } from "@vucinatim/agentic-devtools";
import { createNamecheapClient } from "@vucinatim/agentic-devtools";
```

## Design rule

Keep the integration logic host-agnostic:

1. build the service client and shared behavior in `src/`
2. expose MCP from the same shared layer
3. keep Codex and Claude wrappers thin and replaceable

## Current plugins

- `namecheap`
- `railway`

## Development

Current validation commands:

```bash
npm run build
npm test
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
