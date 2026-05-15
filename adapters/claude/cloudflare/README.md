# Claude Adapter

Claude-facing adapters should wrap the published Cloudflare MCP runtime:

- `npx -y @vucinatim/agentic-devtools mcp cloudflare`

Keep this adapter thin:

1. reuse the shared Cloudflare client
2. avoid duplicating DNS or R2 API logic
3. keep host-specific setup outside `src/`
