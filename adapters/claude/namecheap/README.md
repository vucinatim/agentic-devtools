# Claude Adapter

This plugin does not currently need a Claude-specific wrapper.

The shared runtime already exposes MCP from:

- `../../../src/cli.mjs mcp namecheap`

If Claude or another host needs packaging later, keep it thin:

1. point the host to the shared MCP entrypoint
2. avoid duplicating Namecheap client logic
3. keep any host metadata inside this folder only
