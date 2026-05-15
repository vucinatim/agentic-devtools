import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createRailwayClient,
  getRailwayAuthStatus,
  RailwayApiError,
  resolveRailwayApiToken,
} from "../../../src/tools/railway/client.mjs";

test("resolves project token before account tokens", () => {
  assert.deepEqual(
    resolveRailwayApiToken({
      RAILWAY_PROJECT_TOKEN: "project-token",
      RAILWAY_API_TOKEN: "account-token",
    }),
    {
      token: "project-token",
      kind: "project",
      source: "env:RAILWAY_PROJECT_TOKEN",
    },
  );
});

test("reports Railway auth status without exposing token values", () => {
  const status = getRailwayAuthStatus({
    RAILWAY_API_TOKEN: "account-token",
    RAILWAY_PROJECT_ID: "project-id",
  });

  assert.equal(status.configured, true);
  assert.equal(status.kind, "account");
  assert.equal(status.source, "env:RAILWAY_API_TOKEN");
  assert.equal(status.endpoint, "https://backboard.railway.com/graphql/v2");
  assert.equal(status.defaultProjectId, "project-id");
  assert.equal("token" in status, false);
  assert.match(status.configPath, /railway\.json$/);
});

test("uses bearer auth for account token requests", async () => {
  const calls = [];
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        data: {
          me: {
            name: "Tim",
            email: "tim@example.com",
            workspaces: [],
          },
        },
      });
    },
  });

  const viewer = await client.getCurrentViewer();

  assert.equal(viewer.email, "tim@example.com");
  assert.equal(calls[0].init.headers.Authorization, "Bearer account-token");
  assert.equal(calls[0].init.headers["Project-Access-Token"], undefined);
});

test("validates scoped account tokens via project listing", async () => {
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async () =>
      jsonResponse({
        data: {
          projects: {
            edges: [
              {
                node: {
                  id: "project-id",
                  name: "magnify",
                  workspace: {
                    id: "workspace-id",
                    name: "Tim Vučina's Projects",
                  },
                },
              },
            ],
          },
        },
      }),
  });

  const result = await client.validateAccountToken();

  assert.deepEqual(result, {
    ok: true,
    projectCountSampled: 1,
    sampleProjects: [
      {
        id: "project-id",
        name: "magnify",
        workspace: "Tim Vučina's Projects",
      },
    ],
  });
});

test("uses project access token for project token requests", async () => {
  const calls = [];
  const client = createRailwayClient({
    env: {
      RAILWAY_PROJECT_TOKEN: "project-token",
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        data: {
          projectToken: {
            id: "token-id",
            name: "token",
            projectId: "project-id",
            environmentId: "env-id",
            project: {
              id: "project-id",
              name: "Project",
              workspace: null,
              baseEnvironmentId: "env-id",
              primaryEnvironmentId: "env-id",
            },
            environment: {
              id: "env-id",
              name: "production",
              projectId: "project-id",
              isEphemeral: false,
              canAccess: true,
            },
          },
        },
      });
    },
  });

  const context = await client.getProjectTokenContext();

  assert.equal(context.projectId, "project-id");
  assert.equal(calls[0].init.headers["Project-Access-Token"], "project-token");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("blocks account-scoped project listing when only a project token is configured", async () => {
  const client = createRailwayClient({
    env: {
      RAILWAY_PROJECT_TOKEN: "project-token",
    },
    fetchImpl: async () => jsonResponse({ data: {} }),
  });

  await assert.rejects(
    () => client.listProjects(),
    (error) =>
      error instanceof RailwayApiError &&
      error.message.includes("requires an account token"),
  );
});

test("normalizes project connection fields", async () => {
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async () =>
      jsonResponse({
        data: {
          project: {
            id: "project-id",
            name: "Project",
            prDeploys: false,
            focusedPrEnvironments: false,
            botPrEnvironments: false,
            baseEnvironmentId: "env-id",
            primaryEnvironmentId: "env-id",
            workspace: { id: "workspace-id", name: "Workspace" },
            environments: {
              edges: [{ node: { id: "env-id", name: "production" } }],
            },
            services: {
              edges: [{ node: { id: "service-id", name: "api" } }],
            },
          },
        },
      }),
  });

  const project = await client.getProject("project-id");

  assert.deepEqual(project.environments, [{ id: "env-id", name: "production" }]);
  assert.deepEqual(project.services, [{ id: "service-id", name: "api" }]);
});

test("resolves Railway project, environment, and service selectors by name", async () => {
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async (_url, init) => {
      const request = parseGraphqlRequest(init);

      if (request.query.includes("query RailwayProjects")) {
        return jsonResponse({
          data: {
            projects: {
              edges: [
                {
                  node: {
                    id: "project-id",
                    name: "magnify",
                    workspace: { id: "workspace-id", name: "Workspace" },
                  },
                },
              ],
            },
          },
        });
      }

      if (request.query.includes("query RailwayProject(")) {
        return jsonResponse({
          data: {
            project: {
              id: "project-id",
              name: "magnify",
              prDeploys: false,
              focusedPrEnvironments: false,
              botPrEnvironments: false,
              baseEnvironmentId: "env-production",
              primaryEnvironmentId: "env-production",
              workspace: { id: "workspace-id", name: "Workspace" },
              environments: {
                edges: [
                  { node: { id: "env-production", name: "production" } },
                  { node: { id: "env-preview", name: "preview" } },
                ],
              },
              services: {
                edges: [{ node: { id: "service-id", name: "api" } }],
              },
            },
          },
        });
      }

      if (request.query.includes("query RailwayEnvironment(")) {
        return jsonResponse({
          data: {
            environment: {
              id: "env-production",
              name: "production",
              projectId: "project-id",
              isEphemeral: false,
              canAccess: true,
              sourceEnvironment: null,
              serviceInstances: {
                edges: [
                  {
                    node: {
                      id: "instance-id",
                      environmentId: "env-production",
                      serviceId: "service-id",
                      serviceName: "api",
                      domains: { serviceDomains: [], customDomains: [] },
                    },
                  },
                ],
              },
            },
          },
        });
      }

      return jsonResponse({ data: {} });
    },
  });

  const project = await client.resolveProjectSelector({
    projectName: "magnify",
    operation: "test",
  });
  const environment = await client.resolveEnvironmentSelector({
    projectName: "magnify",
    operation: "test",
  });
  const service = await client.resolveServiceSelector({
    projectName: "magnify",
    environmentName: "production",
    serviceName: "api",
    operation: "test",
  });

  assert.equal(project.projectId, "project-id");
  assert.equal(environment.environmentId, "env-production");
  assert.equal(service.serviceId, "service-id");
  assert.equal(service.environmentId, "env-production");
});

test("surfaces Railway GraphQL errors", async () => {
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async () =>
      jsonResponse({
        errors: [{ message: "No access" }],
      }),
  });

  await assert.rejects(
    () => client.getCurrentViewer(),
    (error) => error instanceof RailwayApiError && error.message === "No access",
  );
});

test("manages Railway project lifecycle mutations with compacted inputs", async () => {
  const calls = [];
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async (_url, init) => {
      calls.push(parseGraphqlRequest(init));
      return jsonResponse({
        data: {
          projectCreate: {
            id: "project-id",
            name: "Magnify Core",
            description: "media control plane",
            workspace: { id: "workspace-id", name: "Workspace" },
          },
          projectUpdate: {
            id: "project-id",
            name: "Magnify Core",
            description: "updated",
            prDeploys: true,
            focusedPrEnvironments: false,
            botPrEnvironments: true,
            isPublic: false,
          },
          projectDelete: true,
          projectTransfer: true,
        },
      });
    },
  });

  const created = await client.createProject({
    name: "Magnify Core",
    description: "media control plane",
    workspaceId: "workspace-id",
    isPublic: undefined,
  });
  const updated = await client.updateProject({
    projectId: "project-id",
    description: "updated",
    botPrEnvironments: true,
    name: undefined,
  });
  const deleted = await client.deleteProject("project-id");
  const transferred = await client.transferProject({
    projectId: "project-id",
    workspaceId: "workspace-2",
  });

  assert.equal(created.id, "project-id");
  assert.equal(updated.description, "updated");
  assert.deepEqual(deleted, { deleted: true, projectId: "project-id" });
  assert.deepEqual(transferred, {
    transferred: true,
    projectId: "project-id",
    workspaceId: "workspace-2",
  });

  assert.match(calls[0].query, /projectCreate/);
  assert.deepEqual(calls[0].variables, {
    input: {
      name: "Magnify Core",
      description: "media control plane",
      workspaceId: "workspace-id",
    },
  });
  assert.match(calls[1].query, /projectUpdate/);
  assert.deepEqual(calls[1].variables, {
    id: "project-id",
    input: {
      description: "updated",
      botPrEnvironments: true,
    },
  });
  assert.deepEqual(calls[2].variables, { id: "project-id" });
  assert.deepEqual(calls[3].variables, {
    projectId: "project-id",
    input: {
      workspaceId: "workspace-2",
    },
  });
});

test("manages Railway services, deployments, and limits", async () => {
  const calls = [];
  const client = createRailwayClient({
    env: {
      RAILWAY_PROJECT_TOKEN: "project-token",
    },
    fetchImpl: async (_url, init) => {
      calls.push(parseGraphqlRequest(init));
      return jsonResponse({
        data: {
          serviceCreate: {
            id: "service-id",
            name: "api",
            icon: "docker",
            projectId: "project-id",
          },
          serviceUpdate: {
            id: "service-id",
            name: "api-renamed",
            icon: "postgresql",
            projectId: "project-id",
          },
          serviceConnect: {
            id: "service-id",
            name: "api-renamed",
            icon: "postgresql",
            projectId: "project-id",
          },
          serviceDisconnect: {
            id: "service-id",
            name: "api-renamed",
            icon: "postgresql",
            projectId: "project-id",
          },
          serviceDelete: true,
          serviceInstanceUpdate: true,
          serviceInstanceDeploy: true,
          serviceInstanceRedeploy: true,
          serviceInstanceLimitsUpdate: true,
        },
      });
    },
  });

  await client.createService({
    projectId: "project-id",
    name: "api",
    icon: "docker",
    source: { repo: "vucinatim/magnify-core" },
    branch: undefined,
  });
  await client.updateService({
    serviceId: "service-id",
    name: "api-renamed",
    icon: "postgresql",
  });
  await client.connectService({
    serviceId: "service-id",
    repo: "vucinatim/magnify-core",
    branch: "main",
    image: undefined,
  });
  assert.deepEqual(await client.disconnectService("service-id"), {
    id: "service-id",
    name: "api-renamed",
    icon: "postgresql",
    projectId: "project-id",
  });
  assert.deepEqual(
    await client.deleteService({ serviceId: "service-id", environmentId: "env-id" }),
    {
      deleted: true,
      serviceId: "service-id",
      environmentId: "env-id",
    },
  );
  assert.deepEqual(
    await client.updateServiceInstance({
      serviceId: "service-id",
      environmentId: "env-id",
      rootDirectory: "apps/api",
      watchPatterns: ["apps/api/**"],
      startCommand: undefined,
    }),
    {
      updated: true,
      serviceId: "service-id",
      environmentId: "env-id",
    },
  );
  assert.deepEqual(
    await client.deployService({
      serviceId: "service-id",
      environmentId: "env-id",
      latestCommit: true,
    }),
    {
      triggered: true,
      serviceId: "service-id",
      environmentId: "env-id",
      commitSha: null,
      latestCommit: true,
    },
  );
  assert.deepEqual(
    await client.redeployService({
      serviceId: "service-id",
      environmentId: "env-id",
    }),
    {
      triggered: true,
      serviceId: "service-id",
      environmentId: "env-id",
    },
  );
  assert.deepEqual(
    await client.updateServiceInstanceLimits({
      serviceId: "service-id",
      environmentId: "env-id",
      memoryGB: 8,
      vCPUs: 4,
    }),
    {
      updated: true,
      serviceId: "service-id",
      environmentId: "env-id",
      memoryGB: 8,
      vCPUs: 4,
    },
  );

  assert.match(calls[0].query, /serviceCreate/);
  assert.deepEqual(calls[0].variables, {
    input: {
      projectId: "project-id",
      name: "api",
      icon: "docker",
      source: { repo: "vucinatim/magnify-core" },
    },
  });
  assert.deepEqual(calls[2].variables, {
    id: "service-id",
    input: {
      repo: "vucinatim/magnify-core",
      branch: "main",
    },
  });
  assert.deepEqual(calls[5].variables, {
    serviceId: "service-id",
    environmentId: "env-id",
    input: {
      rootDirectory: "apps/api",
      watchPatterns: ["apps/api/**"],
    },
  });
  assert.deepEqual(calls[8].variables, {
    input: {
      serviceId: "service-id",
      environmentId: "env-id",
      memoryGB: 8,
      vCPUs: 4,
    },
  });
});

test("manages Railway environments, variables, domains, volumes, and deployment queries", async () => {
  const calls = [];
  const client = createRailwayClient({
    env: {
      RAILWAY_API_TOKEN: "account-token",
    },
    fetchImpl: async (_url, init) => {
      calls.push(parseGraphqlRequest(init));
      return jsonResponse({
        data: {
          projectMembers: [
            {
              id: "member-id",
              role: "ADMIN",
              name: "Tim",
              email: "tim@example.com",
              avatar: null,
            },
          ],
          service: {
            id: "service-id",
            name: "api",
            icon: "docker",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
            featureFlags: [],
            project: { id: "project-id", name: "Magnify" },
          },
          serviceInstance: {
            id: "instance-id",
            serviceId: "service-id",
            serviceName: "api",
            environmentId: "env-id",
            rootDirectory: "apps/api",
            railwayConfigFile: "railway.json",
            buildCommand: "pnpm build",
            startCommand: "pnpm start",
            healthcheckPath: "/health",
            cronSchedule: null,
            latestDeployment: null,
            domains: {
              serviceDomains: [{ id: "sd-1", domain: "api.up.railway.app" }],
              customDomains: [{ id: "cd-1", domain: "api.example.com" }],
            },
          },
          serviceInstanceLimits: { memoryGB: 8, vCPUs: 4 },
          deployment: {
            id: "deployment-id",
            status: "SUCCESS",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            statusUpdatedAt: "2026-01-01T00:00:00.000Z",
            canRedeploy: true,
            canRollback: false,
            deploymentStopped: false,
            environmentId: "env-id",
            projectId: "project-id",
            serviceId: "service-id",
            url: "https://api.up.railway.app",
            staticUrl: null,
            service: { id: "service-id", name: "api" },
            environment: { id: "env-id", name: "production" },
          },
          deployments: {
            edges: [
              {
                node: {
                  id: "deployment-id",
                  status: "SUCCESS",
                  createdAt: "2026-01-01T00:00:00.000Z",
                  updatedAt: "2026-01-01T00:00:00.000Z",
                  environmentId: "env-id",
                  projectId: "project-id",
                  serviceId: "service-id",
                  url: "https://api.up.railway.app",
                  staticUrl: null,
                },
              },
            ],
            pageInfo: {
              hasNextPage: false,
              hasPreviousPage: false,
              startCursor: "start",
              endCursor: "end",
            },
          },
          environmentCreate: {
            id: "env-id",
            name: "preview",
            isEphemeral: true,
            projectId: "project-id",
          },
          environmentDelete: true,
          variableUpsert: true,
          variableDelete: true,
          serviceDomainCreate: {
            id: "sd-1",
            domain: "api.up.railway.app",
          },
          serviceDomainUpdate: true,
          serviceDomainDelete: true,
          customDomainCreate: {
            id: "cd-1",
            domain: "api.example.com",
          },
          customDomainUpdate: true,
          customDomainDelete: true,
          volumeCreate: {
            id: "volume-id",
          },
          volumeDelete: true,
        },
      });
    },
  });

  assert.deepEqual((await client.getProjectMembers("project-id"))[0], {
    id: "member-id",
    role: "ADMIN",
    name: "Tim",
    email: "tim@example.com",
    avatar: null,
  });
  assert.equal((await client.getService("service-id")).projectName, "Magnify");
  assert.equal(
    (await client.getServiceInstance({
      serviceId: "service-id",
      environmentId: "env-id",
    })).domains.customDomains[0].domain,
    "api.example.com",
  );
  assert.deepEqual(
    await client.getServiceInstanceLimits({
      serviceId: "service-id",
      environmentId: "env-id",
    }),
    { memoryGB: 8, vCPUs: 4 },
  );
  assert.equal((await client.getDeployment("deployment-id")).serviceName, "api");
  assert.deepEqual(
    await client.listDeployments({
      projectId: "project-id",
      environmentId: "env-id",
      first: 10,
    }),
    {
      deployments: [
        {
          id: "deployment-id",
          status: "SUCCESS",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          environmentId: "env-id",
          projectId: "project-id",
          serviceId: "service-id",
          url: "https://api.up.railway.app",
          staticUrl: null,
        },
      ],
      pageInfo: {
        hasNextPage: false,
        hasPreviousPage: false,
        startCursor: "start",
        endCursor: "end",
      },
    },
  );
  assert.equal(
    (
      await client.createEnvironment({
        projectId: "project-id",
        name: "preview",
        ephemeral: true,
      })
    ).name,
    "preview",
  );
  assert.deepEqual(await client.deleteEnvironment("env-id"), {
    deleted: true,
    environmentId: "env-id",
  });
  assert.deepEqual(
    await client.upsertVariable({
      projectId: "project-id",
      environmentId: "env-id",
      serviceId: "service-id",
      name: "API_URL",
      value: "https://api.example.com",
      skipDeploys: true,
    }),
    {
      updated: true,
      name: "API_URL",
      environmentId: "env-id",
      serviceId: "service-id",
      projectId: "project-id",
    },
  );
  assert.deepEqual(
    await client.deleteVariable({
      projectId: "project-id",
      environmentId: "env-id",
      serviceId: "service-id",
      name: "API_URL",
    }),
    {
      deleted: true,
      name: "API_URL",
      environmentId: "env-id",
      serviceId: "service-id",
      projectId: "project-id",
    },
  );
  assert.equal(
    (
      await client.createServiceDomain({
        serviceId: "service-id",
        environmentId: "env-id",
      })
    ).domain,
    "api.up.railway.app",
  );
  assert.deepEqual(
    await client.updateServiceDomain({
      serviceDomainId: "sd-1",
      serviceId: "service-id",
      environmentId: "env-id",
      domain: "api.up.railway.app",
      targetPort: 8080,
    }),
    {
      updated: true,
      serviceDomainId: "sd-1",
    },
  );
  assert.deepEqual(await client.deleteServiceDomain("sd-1"), {
    deleted: true,
    serviceDomainId: "sd-1",
  });
  assert.equal(
    (
      await client.createCustomDomain({
        projectId: "project-id",
        environmentId: "env-id",
        serviceId: "service-id",
        domain: "api.example.com",
      })
    ).id,
    "cd-1",
  );
  assert.deepEqual(
    await client.updateCustomDomain({
      customDomainId: "cd-1",
      environmentId: "env-id",
      targetPort: 3000,
    }),
    {
      updated: true,
      customDomainId: "cd-1",
    },
  );
  assert.deepEqual(await client.deleteCustomDomain("cd-1"), {
    deleted: true,
    customDomainId: "cd-1",
  });
  assert.equal(
    (
      await client.createVolume({
        projectId: "project-id",
        environmentId: "env-id",
        serviceId: "service-id",
        mountPath: "/data",
        region: "us-west1",
      })
    ).id,
    "volume-id",
  );
  assert.deepEqual(await client.deleteVolume("volume-id"), {
    deleted: true,
    volumeId: "volume-id",
  });

  assert.deepEqual(calls[5].variables, {
    input: {
      projectId: "project-id",
      environmentId: "env-id",
    },
    first: 10,
    after: null,
    before: null,
    last: null,
  });
  assert.deepEqual(calls[8].variables, {
    input: {
      projectId: "project-id",
      environmentId: "env-id",
      serviceId: "service-id",
      name: "API_URL",
      value: "https://api.example.com",
      skipDeploys: true,
    },
  });
  assert.deepEqual(calls[14].variables, {
    id: "cd-1",
    environmentId: "env-id",
    targetPort: 3000,
  });
  assert.deepEqual(calls[16].variables, {
    input: {
      projectId: "project-id",
      environmentId: "env-id",
      serviceId: "service-id",
      mountPath: "/data",
      region: "us-west1",
    },
  });
});

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

const parseGraphqlRequest = (init) => JSON.parse(init.body);
