# Open Source Readiness

This repo is intended to become public. Treat everything committed here as
publishable by default.

## Repository Identity

Recommended GitHub repo:

```txt
vucinatim/agentic-devtools
```

Recommended npm package:

```txt
@vucinatim/agentic-devtools
```

The scoped npm name is the better default because it ties ownership to the
publisher namespace and avoids competing with broad unscoped package names.

As of 2026-05-14, `npm view agentic-devtools` and
`npm view @vucinatim/agentic-devtools` both returned 404 locally, so both names
appeared unclaimed at that moment. Check again immediately before first publish.

## Public Repo Checklist

Before creating the GitHub repo:

- remove local credential files from the working tree
- verify `.gitignore` covers local auth files
- add a license
- add `CONTRIBUTING.md`
- add `SECURITY.md`
- add CI
- add release/publishing docs
- make README accurate for public users
- ensure package metadata points to the final GitHub URL
- run tests from a fresh install

## Secret Hygiene

Never commit:

- local Namecheap auth files
- `.env`
- `.env.*`
- API tokens
- Railway project tokens
- npm tokens
- generated local caches
- `node_modules`

The Namecheap browser auth flow stores credentials outside the repo by default
under the user's config directory. If `NAMECHEAP_AUTH_CONFIG_PATH` points into
the repo during local testing, remove that file before committing.

## License

Recommended license: MIT.

Reason: this is a developer tooling package where easy reuse matters more than
copyleft constraints. MIT also matches common npm ecosystem expectations.

Apache-2.0 is also reasonable if explicit patent language matters more. Pick one
before the first public commit and keep package manifests consistent.

## Minimum Public Metadata

The published package should include:

- `name`
- `version`
- `description`
- `license`
- `repository`
- `homepage`
- `bugs`
- `keywords`
- `bin`
- `exports`
- `files`
- `publishConfig.access`

Keep the package description concrete:

```txt
MCP-first devtools for AI agents.
```

Avoid broad claims until the tool catalog is larger.

## Dependency Posture

Keep dependencies boring and few.

Good defaults:

- `@modelcontextprotocol/sdk`
- `zod`
- `fast-xml-parser` while Namecheap uses XML

Avoid adding frameworks for small CLI routing or config parsing unless they
remove real complexity.

## Documentation Standard

Every tool should document:

- what it can do
- auth variables
- MCP host configuration
- read/write safety model
- exposed MCP tools
- examples
- known limitations

The top-level README should stay concise and route deeper details to `docs/`.
