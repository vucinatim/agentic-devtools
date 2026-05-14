---
name: railway
description: Use the Railway plugin to inspect Railway account, project, environment, service, domain, and deployment state through a small read-only MCP surface.
---

# Railway

Use this plugin when the user needs to inspect Railway projects, environments,
services, domains, or deployment status.

## Intended Scope

- Read account identity
- List Railway projects
- Inspect a project and its environments
- Inspect environment service instances and deployment status
- Run a compact project doctor summary

## Current MCP Tools

- `getRailwayAuthStatus`
- `testRailwayConnection`
- `getRailwayViewer`
- `listRailwayProjects`
- `inspectRailwayProjectToken`
- `getRailwayProject`
- `listRailwayEnvironments`
- `getRailwayEnvironment`
- `doctorRailwayProject`

## Architecture Note

Keep the public plugin surface read-only until write workflows have explicit
confirmation and rollback rules.

## Auth Model

Railway supports different token scopes.

- `RAILWAY_PROJECT_TOKEN` is project-scoped and works for project inspection.
- `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN` is account-scoped and works for account
  identity and project listing.

Prefer project tokens for narrow inspection when a specific project is known.
