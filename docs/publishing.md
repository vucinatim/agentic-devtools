# Publishing

Agentic Devtools should publish to npm from GitHub Actions using npm Trusted
Publishing.

## Recommended Flow

Use:

- GitHub public repo: `vucinatim/agentic-devtools`
- npm package: `@vucinatim/agentic-devtools`
- GitHub Actions CI
- npm Trusted Publishing through OIDC
- provenance attestations

Do not use long-lived npm automation tokens unless Trusted Publishing is blocked.

## Why Trusted Publishing

npm Trusted Publishing creates a trust relationship between npm and the CI
provider through OIDC. For GitHub Actions, the workflow needs `id-token: write`
permission so npm can verify the workflow identity.

npm also publishes provenance attestations automatically when Trusted Publishing
is used from supported CI.

References:

- <https://docs.npmjs.com/trusted-publishers>
- <https://docs.npmjs.com/generating-provenance-statements>
- <https://docs.github.com/actions/automating-your-workflow-with-github-actions/publishing-nodejs-packages>

## Release Management Recommendation

Start simple.

Phase 1:

- manually bump `package.json` version in a PR
- merge after CI passes
- publish from a manual GitHub Actions workflow
- create a GitHub release for the version tag

This avoids heavy release machinery while the package API is still settling.

Phase 2:

- add Changesets once releases become frequent
- require a changeset for user-visible package changes
- let the release PR update version and changelog
- publish after the release PR lands

Changesets is a good fit later because it makes the changelog user-facing rather
than deriving release notes only from commit messages.

Reference:

- <https://github.com/changesets/action>

## Air Jam Reference

Air Jam has a more advanced public package release system:

- `release:public`
- `release:public:next`
- tag-triggered publishing
- selected package publishing
- release validation gates
- GitHub release creation
- `pnpm publish --provenance`

That is a strong setup for a multi-package repo. Agentic Devtools should borrow
the quality bar and provenance posture, not the full custom release machinery
yet.

For this repo, one package means a smaller workflow is cleaner.

## Initial CI

CI should run on pull requests and pushes to `main`:

```yaml
name: CI

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "24"
          cache: "npm"
      - run: npm ci
      - run: npm run check
```

This repo currently uses npm because it is a single package. If it later moves
to pnpm, mirror Air Jam's `corepack` pattern.

## Initial Publish Workflow

The first publish workflow should be manual:

```yaml
name: Publish

on:
  workflow_dispatch:
    inputs:
      tag:
        description: "npm dist-tag"
        required: true
        default: "latest"
        type: choice
        options:
          - latest
          - next

permissions:
  contents: write
  id-token: write

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: "24"
          registry-url: "https://registry.npmjs.org"
          cache: "npm"
      - run: npm ci
      - run: npm run check
      - run: npm publish --access public --tag "${{ github.event.inputs.tag }}"
```

After npm Trusted Publishing is configured for this exact repo and workflow,
`npm publish` should authenticate through OIDC without an npm token.

## npm Trusted Publisher Setup

In npm package settings, configure a trusted publisher for:

- provider: GitHub Actions
- organization/user: `vucinatim`
- repository: `agentic-devtools`
- workflow file: `.github/workflows/publish.yml`
- environment: only if the workflow uses one

The workflow must keep:

```yaml
permissions:
  id-token: write
```

## Package Metadata

The public package should include:

```json
{
  "name": "@vucinatim/agentic-devtools",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/vucinatim/agentic-devtools.git"
  },
  "homepage": "https://github.com/vucinatim/agentic-devtools#readme",
  "bugs": {
    "url": "https://github.com/vucinatim/agentic-devtools/issues"
  },
  "publishConfig": {
    "access": "public"
  }
}
```

## Pre-Publish Checks

Before every release:

- run tests
- run typecheck
- run build
- inspect `npm pack --dry-run`
- verify no credential files are included
- verify CLI entrypoint works from packed output
- verify README examples are current

`npm pack --dry-run` is mandatory before first publish.
