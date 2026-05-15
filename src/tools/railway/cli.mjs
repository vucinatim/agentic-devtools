import { createRailwayClient, RailwayApiError } from "./client.mjs";

export const railwayCliUsage = () => `Usage:
  agentic-devtools railway list-projects [--workspace-id <id>] [--include-deleted]
  agentic-devtools railway get-project [--project-id <id> | --project-name <name>]
  agentic-devtools railway doctor [--project-id <id> | --project-name <name>]
  agentic-devtools railway list-environments [--project-id <id> | --project-name <name>] [--is-ephemeral <true|false>]
  agentic-devtools railway get-environment [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>]
  agentic-devtools railway list-services [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>]
  agentic-devtools railway get-service [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>] [--service-id <id> | --service-name <name>]
  agentic-devtools railway list-deployments [selectors...]
  agentic-devtools railway update-service [selectors...] [--name <name>] [--icon <icon>] [--input-json <json>]
  agentic-devtools railway connect-service [selectors...] [--repo <repo>] [--branch <branch>] [--image <image>] [--input-json <json>]
  agentic-devtools railway disconnect-service [selectors...]
  agentic-devtools railway update-instance [selectors...] [--watch-pattern <pattern> ...] [--root-directory <dir>] [--railway-config-file <file>] [--input-json <json>]
  agentic-devtools railway set-instance-limits [selectors...] [--memory-gb <number>] [--v-cpus <number>]
  agentic-devtools railway deploy [selectors...] [--commit-sha <sha>] [--latest-commit]
  agentic-devtools railway redeploy [selectors...]
  agentic-devtools railway set-variable [selectors...] --name <name> --value <value> [--skip-deploys]
  agentic-devtools railway delete-variable [selectors...] --name <name>
  agentic-devtools railway create-service-domain [selectors...] [--target-port <port>] [--input-json <json>]
  agentic-devtools railway create-custom-domain [selectors...] --domain <domain> [--target-port <port>]

Selectors:
  --project-id / --project-name
  --environment-id / --environment-name
  --service-id / --service-name

Notes:
  - Commands resolve project, environment, and service names when possible.
  - Output is always JSON.
  - Use --input-json for advanced provider fields without dropping to raw GraphQL.
`;

export const runRailwayCli = async (
  argv,
  { client = createRailwayClient() } = {},
) => {
  const { positionals, options } = parseOptions(argv);
  const command = positionals[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    return { __usage: railwayCliUsage() };
  }

  switch (command) {
    case "list-projects":
      return client.listProjects({
        workspaceId: getStringOption(options, "workspace-id"),
        includeDeleted: getBooleanOption(options, "include-deleted") ?? false,
        first: getIntegerOption(options, "first") ?? 100,
      });

    case "get-project": {
      const project = await resolveProject(client, options, command);
      return client.getProject(project.projectId);
    }

    case "doctor": {
      const project = await resolveProject(client, options, command);
      return client.doctorProject({ projectId: project.projectId });
    }

    case "list-environments": {
      const project = await resolveProject(client, options, command);
      return client.listEnvironments({
        projectId: project.projectId,
        isEphemeral: getBooleanOption(options, "is-ephemeral"),
      });
    }

    case "get-environment": {
      const environment = await resolveEnvironment(client, options, command);
      return client.getEnvironment(environment.environmentId);
    }

    case "list-services": {
      if (
        hasSelector(options, "environment-id") ||
        hasSelector(options, "environment-name")
      ) {
        const environment = await resolveEnvironment(client, options, command);
        const detail = await client.getEnvironment(environment.environmentId);
        return detail.serviceInstances.map((entry) => ({
          id: entry.serviceId,
          name: entry.serviceName,
          environmentId: detail.id,
          environmentName: detail.name,
          latestDeployment: entry.latestDeployment ?? null,
        }));
      }

      const project = await resolveProject(client, options, command);
      const detail = await client.getProject(project.projectId);
      return detail.services;
    }

    case "get-service": {
      const service = await resolveService(client, options, command);
      return client.getService(service.serviceId);
    }

    case "list-deployments": {
      const selectors = await resolveDeploymentSelectors(client, options, command);
      return client.listDeployments({
        projectId: selectors.projectId ?? undefined,
        environmentId: selectors.environmentId ?? undefined,
        serviceId: selectors.serviceId ?? undefined,
        first: getIntegerOption(options, "first") ?? 20,
        after: getStringOption(options, "after"),
        before: getStringOption(options, "before"),
        last: getIntegerOption(options, "last") ?? undefined,
      });
    }

    case "update-service": {
      const service = await resolveService(client, options, command);
      return client.updateService({
        serviceId: service.serviceId,
        ...mergeInput(
          {
            name: getStringOption(options, "name"),
            icon: getStringOption(options, "icon"),
          },
          getJsonOption(options, "input-json", command),
        ),
      });
    }

    case "connect-service": {
      const service = await resolveService(client, options, command);
      return client.connectService({
        serviceId: service.serviceId,
        ...mergeInput(
          {
            repo: getStringOption(options, "repo"),
            branch: getStringOption(options, "branch"),
            image: getStringOption(options, "image"),
          },
          getJsonOption(options, "input-json", command),
        ),
      });
    }

    case "disconnect-service": {
      const service = await resolveService(client, options, command);
      return client.disconnectService(service.serviceId);
    }

    case "update-instance": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.updateServiceInstance({
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
        ...mergeInput(
          buildServiceInstanceInput(options, command),
          getJsonOption(options, "input-json", command),
        ),
      });
    }

    case "set-instance-limits": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.updateServiceInstanceLimits({
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
        memoryGB: getNumberOption(options, "memory-gb"),
        vCPUs: getNumberOption(options, "v-cpus"),
      });
    }

    case "deploy": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.deployService({
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
        commitSha: getStringOption(options, "commit-sha"),
        latestCommit: getBooleanOption(options, "latest-commit"),
      });
    }

    case "redeploy": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.redeployService({
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
      });
    }

    case "set-variable": {
      const environment = await resolveEnvironment(client, options, command);
      const service =
        hasSelector(options, "service-id") || hasSelector(options, "service-name")
          ? await resolveService(client, options, command)
          : null;
      return client.upsertVariable({
        projectId: environment.projectId,
        environmentId: environment.environmentId,
        serviceId: service?.serviceId ?? undefined,
        name: requireStringOption(options, "name", command),
        value: requireStringOption(options, "value", command),
        skipDeploys: getBooleanOption(options, "skip-deploys"),
      });
    }

    case "delete-variable": {
      const environment = await resolveEnvironment(client, options, command);
      const service =
        hasSelector(options, "service-id") || hasSelector(options, "service-name")
          ? await resolveService(client, options, command)
          : null;
      return client.deleteVariable({
        projectId: environment.projectId,
        environmentId: environment.environmentId,
        serviceId: service?.serviceId ?? undefined,
        name: requireStringOption(options, "name", command),
      });
    }

    case "create-service-domain": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.createServiceDomain({
        serviceId: instance.serviceId,
        environmentId: instance.environmentId,
        ...mergeInput(
          {
            targetPort: getIntegerOption(options, "target-port"),
          },
          getJsonOption(options, "input-json", command),
        ),
      });
    }

    case "create-custom-domain": {
      const instance = await resolveServiceAndEnvironment(client, options, command);
      return client.createCustomDomain({
        projectId: instance.projectId,
        environmentId: instance.environmentId,
        serviceId: instance.serviceId,
        domain: requireStringOption(options, "domain", command),
        targetPort: getIntegerOption(options, "target-port"),
      });
    }

    default:
      throw new RailwayApiError(
        `Unknown Railway command "${command}".\n\n${railwayCliUsage()}`,
      );
  }
};

const resolveProject = async (client, options, operation) =>
  client.resolveProjectSelector({
    projectId: getStringOption(options, "project-id"),
    projectName: getStringOption(options, "project-name"),
    operation,
  });

const resolveEnvironment = async (client, options, operation) =>
  client.resolveEnvironmentSelector({
    projectId: getStringOption(options, "project-id"),
    projectName: getStringOption(options, "project-name"),
    environmentId: getStringOption(options, "environment-id"),
    environmentName: getStringOption(options, "environment-name"),
    operation,
  });

const resolveService = async (client, options, operation) =>
  client.resolveServiceSelector({
    projectId: getStringOption(options, "project-id"),
    projectName: getStringOption(options, "project-name"),
    environmentId: getStringOption(options, "environment-id"),
    environmentName: getStringOption(options, "environment-name"),
    serviceId: getStringOption(options, "service-id"),
    serviceName: getStringOption(options, "service-name"),
    operation,
  });

const resolveServiceAndEnvironment = async (client, options, operation) => {
  const service = await resolveService(client, options, operation);
  const environment =
    service.environmentId
      ? {
          environmentId: service.environmentId,
          projectId: service.projectId,
          environment: service.environment,
          project: service.project,
        }
      : await resolveEnvironment(client, options, operation);

  return {
    serviceId: service.serviceId,
    environmentId: environment.environmentId,
    projectId: environment.projectId,
  };
};

const resolveDeploymentSelectors = async (client, options, operation) => {
  let projectId = null;
  let environmentId = null;
  let serviceId = null;

  if (hasSelector(options, "project-id") || hasSelector(options, "project-name")) {
    const project = await resolveProject(client, options, operation);
    projectId = project.projectId;
  }

  if (hasSelector(options, "environment-id") || hasSelector(options, "environment-name")) {
    const environment = await resolveEnvironment(client, options, operation);
    projectId = environment.projectId ?? projectId;
    environmentId = environment.environmentId;
  }

  if (hasSelector(options, "service-id") || hasSelector(options, "service-name")) {
    const service = await resolveService(client, options, operation);
    projectId = service.projectId ?? projectId;
    environmentId = service.environmentId ?? environmentId;
    serviceId = service.serviceId;
  }

  return { projectId, environmentId, serviceId };
};

const buildServiceInstanceInput = (options, operation) => {
  const explicit = {
    buildCommand: getStringOption(options, "build-command"),
    builder: getStringOption(options, "builder"),
    cronSchedule: getStringOption(options, "cron-schedule"),
    dockerfilePath: getStringOption(options, "dockerfile-path"),
    drainingSeconds: getIntegerOption(options, "draining-seconds"),
    healthcheckPath: getStringOption(options, "healthcheck-path"),
    healthcheckTimeout: getIntegerOption(options, "healthcheck-timeout"),
    ipv6EgressEnabled: getBooleanOption(options, "ipv6-egress-enabled"),
    multiRegionConfig: getJsonOption(options, "multi-region-config-json", operation),
    nixpacksPlan: getJsonOption(options, "nixpacks-plan-json", operation),
    numReplicas: getIntegerOption(options, "num-replicas"),
    overlapSeconds: getIntegerOption(options, "overlap-seconds"),
    preDeployCommand: getStringArrayOption(options, "pre-deploy-command"),
    railwayConfigFile: getStringOption(options, "railway-config-file"),
    region: getStringOption(options, "region"),
    registryCredentials: getJsonOption(options, "registry-credentials-json", operation),
    restartPolicyMaxRetries: getIntegerOption(
      options,
      "restart-policy-max-retries",
    ),
    restartPolicyType: getStringOption(options, "restart-policy-type"),
    rootDirectory: getStringOption(options, "root-directory"),
    sleepApplication: getBooleanOption(options, "sleep-application"),
    source: getJsonOption(options, "source-json", operation),
    startCommand: getStringOption(options, "start-command"),
    watchPatterns: getStringArrayOption(options, "watch-pattern"),
  };

  return Object.fromEntries(
    Object.entries(explicit).filter(
      ([, value]) => value !== undefined && value !== null,
    ),
  );
};

const mergeInput = (baseInput, jsonInput) =>
  Object.fromEntries(
    Object.entries({
      ...(baseInput ?? {}),
      ...(jsonInput ?? {}),
    }).filter(([, value]) => value !== undefined && value !== null),
  );

const parseOptions = (argv) => {
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    if (value === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (value.startsWith("--no-")) {
      options[value.slice(5)] = false;
      continue;
    }

    const withoutPrefix = value.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    if (eqIndex >= 0) {
      assignOption(options, withoutPrefix.slice(0, eqIndex), withoutPrefix.slice(eqIndex + 1));
      continue;
    }

    const next = argv[index + 1];
    if (next == null || next.startsWith("--")) {
      options[withoutPrefix] = true;
      continue;
    }

    assignOption(options, withoutPrefix, next);
    index += 1;
  }

  return { positionals, options };
};

const assignOption = (options, key, value) => {
  if (!(key in options)) {
    options[key] = value;
    return;
  }

  if (Array.isArray(options[key])) {
    options[key].push(value);
    return;
  }

  options[key] = [options[key], value];
};

const hasSelector = (options, key) => options[key] !== undefined;

const getOptionValue = (options, key) => options[key];

const getStringOption = (options, key) => {
  const value = getOptionValue(options, key);
  if (Array.isArray(value)) {
    return String(value[value.length - 1]).trim();
  }
  if (typeof value === "string") {
    return value.trim();
  }
  return null;
};

const requireStringOption = (options, key, operation) => {
  const value = getStringOption(options, key);
  if (value) {
    return value;
  }
  throw new RailwayApiError(`${operation} requires --${key}.`);
};

const getBooleanOption = (options, key) => {
  const value = getOptionValue(options, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(Array.isArray(value) ? value[value.length - 1] : value)
    .trim()
    .toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  throw new RailwayApiError(`Invalid boolean value for --${key}: ${value}`);
};

const getIntegerOption = (options, key) => {
  const value = getOptionValue(options, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(
    String(Array.isArray(value) ? value[value.length - 1] : value),
    10,
  );
  if (!Number.isFinite(parsed)) {
    throw new RailwayApiError(`Invalid integer value for --${key}: ${value}`);
  }
  return parsed;
};

const getNumberOption = (options, key) => {
  const value = getOptionValue(options, key);
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(
    String(Array.isArray(value) ? value[value.length - 1] : value),
  );
  if (!Number.isFinite(parsed)) {
    throw new RailwayApiError(`Invalid number value for --${key}: ${value}`);
  }
  return parsed;
};

const getStringArrayOption = (options, key) => {
  const value = getOptionValue(options, key);
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry));
  }
  return [String(value)];
};

const getJsonOption = (options, key, operation) => {
  const raw = getStringOption(options, key);
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new RailwayApiError(
      `${operation} received invalid JSON for --${key}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};
