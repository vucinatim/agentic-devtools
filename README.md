# Agentic Devtools

Reusable developer tools for AI agents.

Agentic Devtools is a public-package-ready open-source project that exposes
small, reliable MCP tools for developer platforms such as Railway and Namecheap.
The repo is organized as one publishable package with a shared tool registry and
thin host adapters.

Start here:

- [docs/architecture.md](docs/architecture.md)
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

## Local use

The Codex marketplace entry for `namecheap` points to:

- `./adapters/codex/namecheap`

The shared MCP server implementation lives at:

- `src/tools/namecheap/mcp.mjs`

The Railway plugin follows the same shape:

- `./adapters/codex/railway`
- `src/tools/railway/mcp.mjs`

CLI examples:

```bash
npx @vucinatim/agentic-devtools tools
npx @vucinatim/agentic-devtools mcp railway
npx @vucinatim/agentic-devtools auth-status namecheap
```

## Publishing direction

Publishing should use GitHub Actions and npm Trusted Publishing via OIDC. This
avoids long-lived npm tokens and gives the public package provenance
attestations.

See [docs/publishing.md](docs/publishing.md).
