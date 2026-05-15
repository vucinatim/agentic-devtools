import assert from "node:assert/strict";
import { test } from "vitest";
import { runRailwayCli } from "../../../src/tools/railway/cli.mjs";

test("Railway CLI prints provider-specific usage", async () => {
  const result = await runRailwayCli(["--help"], {
    client: {},
  });

  assert.match(result.__usage, /agentic-devtools railway update-instance/);
  assert.match(result.__usage, /--watch-pattern/);
});

test("Railway CLI resolves project names for get-project", async () => {
  const calls = [];
  const client = {
    resolveProjectSelector: async (input) => {
      calls.push(["resolveProjectSelector", input]);
      return { projectId: "project-id" };
    },
    getProject: async (projectId) => {
      calls.push(["getProject", projectId]);
      return { id: projectId, name: "magnify" };
    },
  };

  const result = await runRailwayCli(
    ["get-project", "--project-name", "magnify"],
    { client },
  );

  assert.equal(result.id, "project-id");
  assert.deepEqual(calls, [
    [
      "resolveProjectSelector",
      {
        projectId: null,
        projectName: "magnify",
        operation: "get-project",
      },
    ],
    ["getProject", "project-id"],
  ]);
});

test("Railway CLI updates service instances with watch patterns and JSON input", async () => {
  const calls = [];
  const client = {
    resolveServiceSelector: async (input) => {
      calls.push(["resolveServiceSelector", input]);
      return {
        serviceId: "service-id",
        environmentId: "env-id",
        projectId: "project-id",
      };
    },
    updateServiceInstance: async (input) => {
      calls.push(["updateServiceInstance", input]);
      return { updated: true, ...input };
    },
  };

  const result = await runRailwayCli(
    [
      "update-instance",
      "--project-name",
      "magnify",
      "--service-name",
      "api",
      "--environment-name",
      "production",
      "--watch-pattern",
      "apps/api/**",
      "--watch-pattern",
      "packages/contracts/**",
      "--root-directory",
      "apps/api",
      "--input-json",
      "{\"sleepApplication\":false}",
    ],
    { client },
  );

  assert.equal(result.updated, true);
  assert.deepEqual(calls[1], [
    "updateServiceInstance",
    {
      serviceId: "service-id",
      environmentId: "env-id",
      watchPatterns: ["apps/api/**", "packages/contracts/**"],
      rootDirectory: "apps/api",
      sleepApplication: false,
    },
  ]);
});

test("Railway CLI sets variables with resolved selectors", async () => {
  const calls = [];
  const client = {
    resolveEnvironmentSelector: async (input) => {
      calls.push(["resolveEnvironmentSelector", input]);
      return {
        environmentId: "env-id",
        projectId: "project-id",
      };
    },
    resolveServiceSelector: async (input) => {
      calls.push(["resolveServiceSelector", input]);
      return {
        serviceId: "service-id",
      };
    },
    upsertVariable: async (input) => {
      calls.push(["upsertVariable", input]);
      return { updated: true };
    },
  };

  await runRailwayCli(
    [
      "set-variable",
      "--project-name",
      "magnify",
      "--environment-name",
      "production",
      "--service-name",
      "api",
      "--name",
      "NODE_ENV",
      "--value",
      "production",
      "--skip-deploys",
    ],
    { client },
  );

  assert.deepEqual(calls[2], [
    "upsertVariable",
    {
      projectId: "project-id",
      environmentId: "env-id",
      serviceId: "service-id",
      name: "NODE_ENV",
      value: "production",
      skipDeploys: true,
    },
  ]);
});
