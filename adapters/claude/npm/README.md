# Claude Adapter

Claude-facing adapters should wrap the published npm MCP runtime:

- `npx -y @vucinatim/agentic-devtools mcp npm`

Keep this adapter thin:

1. reuse the shared npm client
2. avoid duplicating registry API logic
3. keep host-specific setup outside `src/`
