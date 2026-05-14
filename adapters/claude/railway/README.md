# Claude Adapter

Claude-facing adapters should wrap the shared Railway MCP runtime:

- `../../../src/cli.mjs mcp railway`

Keep this adapter thin:

1. reuse the shared Railway client
2. avoid duplicating GraphQL logic
3. keep host-specific setup outside `src/`
