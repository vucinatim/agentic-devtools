# Contributing

Agentic Devtools is intended to stay small, explicit, and safe for agent-driven
developer workflows.

## Development Principles

- keep service clients isolated by tool
- keep host adapters thin
- default new tools to read-only
- add write tools only with clear confirmation and idempotency behavior
- prefer small dependencies and boring infrastructure
- test auth resolution, API parsing, and dangerous edge cases

## Local Development

Current validation commands:

```bash
npm run test:namecheap
npm run test:railway
```

The package architecture is being consolidated. See
[docs/migration-plan.md](docs/migration-plan.md) before making broad structural
changes.

## Pull Requests

For every PR, include:

- what changed
- why it changed
- validation commands run
- any auth, safety, or publishing implications

If a change adds or modifies write behavior, call that out clearly.

## Tool Additions

When adding a tool, include:

- service client
- MCP registration
- auth documentation
- tests
- adapter metadata only if the tool should be exposed to a host
- README or docs updates

Do not duplicate service logic inside host adapters.
