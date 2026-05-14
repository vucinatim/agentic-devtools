# Architecture

Agentic Devtools should be a small, professional open-source package for
agent-friendly developer integrations.

The core idea is simple:

- one package contains all tools
- each tool owns its service-specific client and schemas
- a shared registry exposes tools through MCP-first CLI execution
- host-specific integrations stay thin and replaceable

## Package Strategy

Use one public npm package for now:

```txt
@vucinatim/agentic-devtools
```

This is the right default because the current tools have the same audience,
runtime, release cadence, and MCP shape. Separate packages would add release and
coordination overhead before the project has enough tool-specific complexity to
need it.

Split into separate packages only when one of these becomes true:

- a tool has a large dependency tree that should not ship to everyone
- a tool has a materially different runtime target
- a tool needs independent versioning because users depend on it separately
- the package grows enough that install size becomes a real problem

Until then, keep a single package and expose separate entrypoints.

## Usage Model

The primary usage path is MCP execution through `npx`:

```bash
npx -y @vucinatim/agentic-devtools mcp railway
npx -y @vucinatim/agentic-devtools mcp namecheap
```

This keeps Agentic Devtools out of the user's application dependency tree.

Secondary paths:

- global CLI install for repeated terminal use
- package dependency install for users building custom automation

## Target Layout

```txt
agentic-devtools/
  src/
    cli.ts
    index.ts
    core/
      mcp-server.ts
      result.ts
      tool-registry.ts
    tools/
      namecheap/
        auth.ts
        client.ts
        index.ts
        mcp.ts
        schemas.ts
      railway/
        client.ts
        index.ts
        mcp.ts
        schemas.ts
  adapters/
    codex/
      namecheap/
      railway/
    claude/
      namecheap/
      railway/
  tests/
    tools/
      namecheap/
      railway/
  docs/
```

The earlier `plugins/<tool>/src` bootstrap layout has been retired. The package
now has one source tree, one CLI, and one release flow.

## Public API Shape

The package should expose MCP execution through the CLI first, then
programmatic imports for custom builders.

Example package surface:

```json
{
  "name": "@vucinatim/agentic-devtools",
  "bin": {
    "agentic-devtools": "./dist/cli.js"
  },
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./namecheap": {
      "types": "./dist/tools/namecheap/index.d.ts",
      "import": "./dist/tools/namecheap/index.js"
    },
    "./railway": {
      "types": "./dist/tools/railway/index.d.ts",
      "import": "./dist/tools/railway/index.js"
    }
  }
}
```

Example CLI usage:

```bash
npx -y @vucinatim/agentic-devtools mcp namecheap
npx -y @vucinatim/agentic-devtools mcp railway
npx @vucinatim/agentic-devtools auth-status railway
```

## Tool Boundaries

Each tool module should own:

- auth resolution for that service
- API client calls
- request and response schemas
- MCP tool registration for that service
- tests for API parsing, auth behavior, and dangerous edge cases

The shared core should own:

- common tool-result formatting
- shared MCP server setup
- CLI routing
- registry lookup
- consistent error shape

The shared core should not know service-specific API details.

## Write Operations

Default new integrations to read-only.

Add write tools only when the workflow has:

- explicit user intent
- narrow inputs
- a dry-run or preview path when possible
- clear idempotency behavior
- tests for no-op, duplicate, and failure cases

Railway should remain read-only until deployment, variable mutation, and service
changes have a proper confirmation model.

Namecheap already has DNS mutation tools. Those should continue to prefer
preserving existing state and should clearly label full-zone replacement as
destructive.

## Host Adapters

Codex and Claude adapters should be metadata and launch wrappers only.

Published host configs should prefer:

```json
{
  "command": "npx",
  "args": ["-y", "@vucinatim/agentic-devtools", "mcp", "<tool>"]
}
```

They should not duplicate:

- service clients
- GraphQL or REST calls
- mutation logic
- tool validation rules

If a host needs a custom shape, adapt at the edge and call the shared tool
module underneath.
