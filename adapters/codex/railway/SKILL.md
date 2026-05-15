---
name: railway
description: Use the Railway plugin to inspect and manage Railway account, project, environment, service, domain, deployment, variable, and volume state through the published Agentic Devtools MCP surface.
---

# Railway

Use this plugin when the user needs to inspect or manage Railway projects,
environments, services, deployments, domains, variables, or volumes.

## Intended Scope

- Read account identity and project scope
- Create, update, and delete projects
- Create, update, deploy, redeploy, connect, disconnect, and delete services
- Inspect and update service instances, limits, and deployments
- Manage environments, variables, domains, and volumes
- Run a compact project doctor summary

## Current MCP Tools

- `getRailwayAuthStatus`
- `testRailwayConnection`
- `getRailwayViewer`
- `listRailwayProjects`
- `inspectRailwayProjectToken`
- `getRailwayProject`
- `createRailwayProject`
- `updateRailwayProject`
- `deleteRailwayProject`
- `transferRailwayProject`
- `listRailwayProjectMembers`
- `listRailwayEnvironments`
- `getRailwayEnvironment`
- `createRailwayEnvironment`
- `deleteRailwayEnvironment`
- `getRailwayService`
- `createRailwayService`
- `updateRailwayService`
- `connectRailwayService`
- `disconnectRailwayService`
- `deleteRailwayService`
- `getRailwayServiceInstance`
- `updateRailwayServiceInstance`
- `getRailwayServiceInstanceLimits`
- `updateRailwayServiceInstanceLimits`
- `listRailwayDeployments`
- `getRailwayDeployment`
- `deployRailwayServiceInstance`
- `redeployRailwayServiceInstance`
- `upsertRailwayVariable`
- `deleteRailwayVariable`
- `createRailwayServiceDomain`
- `updateRailwayServiceDomain`
- `deleteRailwayServiceDomain`
- `createRailwayCustomDomain`
- `updateRailwayCustomDomain`
- `deleteRailwayCustomDomain`
- `createRailwayVolume`
- `deleteRailwayVolume`
- `doctorRailwayProject`

## Auth Model

Railway supports different token scopes.

- `RAILWAY_PROJECT_TOKEN` is project-scoped and works for project inspection and
  mutation within the project token's scope.
- `RAILWAY_API_TOKEN` or `RAILWAY_TOKEN` is account-scoped or workspace-scoped
  and works for broader project and workspace management.

Prefer the narrowest token scope that fits the task.
