---
name: npm
description: Use the npm plugin to inspect npm registry packages, package names, auth status, tokens, and publishing setup through Agentic Devtools.
---

# npm

Use this plugin when the user needs to inspect npm packages, check whether a
package name is available, validate npm auth, inspect token state, or run a
publish dry-run.

## Intended Scope

- Read public package metadata
- Check package name availability
- List package versions and dist-tags
- Check npm auth status without exposing tokens
- Inspect token lists when an authenticated npm token is configured
- Run local `npm publish --dry-run`
- Run real local publishing only when explicitly confirmed

## Current MCP Tools

- `getNpmAuthStatus`
- `connectNpm`
- `disconnectNpm`
- `testNpmConnection`
- `getNpmPackageInfo`
- `checkNpmPackageNameAvailability`
- `getNpmPackageVersions`
- `getNpmPackageDistTags`
- `getNpmPackageVisibility`
- `setNpmPackageAccess`
- `listNpmTokens`
- `exchangeNpmOidcToken`
- `getNpmTrustedPublishers`
- `addNpmGitHubTrustedPublisher`
- `deleteNpmTrustedPublisher`
- `publishNpmPackageDirectory`

## Auth Model

npm does not provide a normal third-party OAuth flow for local tools.

Supported auth sources:

- `NPM_TOKEN`
- `NODE_AUTH_TOKEN`
- explicit npm user config via `.npmrc`
- local Agentic Devtools storage from `connectNpm`

Prefer GitHub Actions Trusted Publishing for real package releases. Local
publishing is available for controlled cases, but it requires an explicit
confirmation string.
