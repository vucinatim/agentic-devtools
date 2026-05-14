# Testing

Agentic Devtools uses Vitest for package tests.

The test suite should validate three layers:

- service clients and auth resolution
- shared core helpers and registry behavior
- public package surfaces such as MCP-first CLI commands and exports

## Commands

```bash
npm test
npm run test:namecheap
npm run test:railway
npm run coverage
npm run check
```

`npm run check` is the CI gate. It runs:

1. syntax validation for JavaScript source and test files
2. Vitest with coverage thresholds
3. production dependency audit
4. package dry-run validation

## Coverage Scope

Coverage measures library code under `src/`, excluding:

- `src/cli.mjs`
- `src/tools/*/mcp.mjs`

Those files are integration entrypoints. Their behavior should be covered by
CLI smoke tests and MCP-level tests, not line-by-line unit coverage.

Current minimum thresholds:

- statements: 65%
- branches: 50%
- functions: 65%
- lines: 65%

Raise these as the browser auth flow and MCP entrypoints get more direct test
coverage.

## Package Validation

`npm run validate:package` runs `npm pack --dry-run --json` and verifies that
the public tarball:

- includes required runtime files
- excludes tests
- excludes GitHub workflow files
- excludes local auth files
- excludes environment files
- excludes generated tarballs

This is mandatory for a public package because package contents are part of the
security boundary.
