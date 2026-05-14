# Security Policy

Agentic Devtools connects agents to developer accounts and infrastructure. Treat
credentials, destructive actions, and package publishing as high-risk surfaces.

## Supported Versions

This project has not published a stable version yet. Security fixes should
target the main branch until the first public release.

## Reporting A Vulnerability

Do not open a public issue for credential exposure, auth bypasses, or unsafe
write behavior.

Report security issues privately to:

```txt
tim@vucina.com
```

Include:

- affected tool
- reproduction steps
- expected impact
- whether credentials or account data may be exposed

## Credential Handling

Never commit:

- `.env`
- `.env.*`
- local Namecheap auth config files
- Railway tokens
- Namecheap API credentials
- npm tokens

Use environment variables or local ignored auth files for development.

## Write Tool Policy

Read-only tools are preferred by default.

Write tools must be narrow, explicit, and tested. Destructive operations should
make that behavior clear in the tool name, description, or input contract.
