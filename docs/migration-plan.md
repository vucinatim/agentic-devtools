# Migration Plan

This plan tracks the move from the original plugin bootstrap layout to a single
professional public npm package.

## Phase 1: Public Repo Baseline

- choose license: done
- add `CONTRIBUTING.md`: done
- add `SECURITY.md`: done
- remove local credential files from the working tree: done
- initialize Git
- create public GitHub repo
- push initial baseline

## Phase 2: Package Consolidation

- move shared source from `plugins/namecheap/src` into `src/tools/namecheap`: done
- move shared source from `plugins/railway/src` into `src/tools/railway`: done
- create `src/core` for registry and result formatting: done
- create `src/cli.mjs`: done
- keep adapter metadata thin under `adapters/`: done
- replace per-plugin package manifests with one root package manifest: done

## Phase 3: TypeScript Build

- add TypeScript
- add `tsup`
- add generated `dist`
- add package `exports`
- add package `bin`
- convert tests to run against source or built output consistently

## Phase 4: CI

- add GitHub Actions CI: done
- run install, tests, and build: done
- add pull request template: done
- add issue templates: done

## Phase 5: Publish

- configure npm package metadata: done
- configure npm Trusted Publishing
- add manual publish workflow: done
- run `npm pack --dry-run`
- publish `0.1.0` under `latest`
- create GitHub release

## Phase 6: Release Management

Add Changesets only after release cadence justifies it.

Until then, manual version bumps plus a guarded publish workflow are simpler and
easier to reason about.
