import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(
    getRailwayAuthStatus({
      RAILWAY_API_TOKEN: "account-token",
      RAILWAY_PROJECT_ID: "project-id",
    }),
    {
      configured: true,
      kind: "account",
      source: "env:RAILWAY_API_TOKEN",
      endpoint: "https://backboard.railway.com/graphql/v2",
      defaultProjectId: "project-id",
    },
  );
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

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});
