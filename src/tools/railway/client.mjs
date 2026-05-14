import {
  DEFAULT_RAILWAY_API_ENDPOINT,
  getRailwayAuthStatus,
  resolveRailwayApiToken,
} from "./auth.mjs";

export { getRailwayAuthStatus, resolveRailwayApiToken } from "./auth.mjs";

export class RailwayApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "RailwayApiError";
    this.details = details;
  }
}

export const createRailwayClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const auth = resolveRailwayApiToken(env);
  const status = getRailwayAuthStatus(env);
  const endpoint = status.endpoint || DEFAULT_RAILWAY_API_ENDPOINT;

  if (typeof fetchImpl !== "function") {
    throw new Error("Railway client requires a fetch implementation.");
  }

  const request = async (query, variables = {}) => {
    if (!auth.token) {
      throw new RailwayApiError(
        "Missing Railway API token. Run `agentic-devtools connect railway`, or set RAILWAY_PROJECT_TOKEN, RAILWAY_API_TOKEN, or RAILWAY_TOKEN.",
      );
    }

    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth.kind === "project"
          ? { "Project-Access-Token": auth.token }
          : { Authorization: `Bearer ${auth.token}` }),
      },
      body: JSON.stringify({
        query,
        variables,
      }),
    });

    const payload = await response.json().catch(async () => response.text());
    if (!response.ok || hasErrors(payload)) {
      throw new RailwayApiError(
        formatRailwayErrorMessage(payload, response.status),
        {
          status: response.status,
          errors: hasErrors(payload) ? payload.errors : [],
          payload,
        },
      );
    }

    return payload.data;
  };

  const requireAccountToken = (operation) => {
    if (auth.kind === "project") {
      throw new RailwayApiError(
        `${operation} requires an account token. Set RAILWAY_API_TOKEN or RAILWAY_TOKEN, or use a project-scoped tool.`,
      );
    }
  };

  const resolveProjectId = async (projectId) => {
    const explicit = projectId?.trim() || status.defaultProjectId;
    if (explicit) {
      return explicit;
    }

    if (auth.kind === "project") {
      const context = await getProjectTokenContext();
      return context.projectId;
    }

    throw new RailwayApiError(
      "Missing Railway project id. Pass projectId, set RAILWAY_PROJECT_ID, or use RAILWAY_PROJECT_TOKEN.",
    );
  };

  const requireResolvedProjectId = async (projectId, operation) => {
    try {
      return await resolveProjectId(projectId);
    } catch (error) {
      throw new RailwayApiError(
        error instanceof Error ? error.message : `${operation} requires a Railway project id.`,
      );
    }
  };

  const getCurrentViewer = async () => {
    requireAccountToken("getRailwayViewer");
    const data = await request(`
      query RailwayViewer {
        me {
          name
          email
          workspaces {
            id
            name
          }
        }
      }
    `);
    return data.me;
  };

  const validateAccountToken = async () => {
    requireAccountToken("validateRailwayAccountToken");
    const projects = await listProjects({ first: 1, includeDeleted: false });
    return {
      ok: true,
      projectCountSampled: projects.length,
      sampleProjects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        workspace: project.workspace?.name ?? null,
      })),
    };
  };

  const listProjects = async ({
    workspaceId = null,
    includeDeleted = false,
    first = 100,
  } = {}) => {
    requireAccountToken("listRailwayProjects");
    const data = await request(
      `
        query RailwayProjects($workspaceId: String, $includeDeleted: Boolean, $first: Int) {
          projects(
            workspaceId: $workspaceId
            includeDeleted: $includeDeleted
            first: $first
          ) {
            edges {
              node {
                id
                name
                updatedAt
                deletedAt
                workspace {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      { workspaceId, includeDeleted, first },
    );
    return connectionNodes(data.projects);
  };

  const getProjectTokenContext = async () => {
    const data = await request(`
      query RailwayProjectTokenContext {
        projectToken {
          id
          name
          projectId
          environmentId
          project {
            id
            name
            workspace {
              id
              name
            }
            baseEnvironmentId
            primaryEnvironmentId
          }
          environment {
            id
            name
            projectId
            isEphemeral
            canAccess
          }
        }
      }
    `);
    return data.projectToken;
  };

  const getProject = async (projectId) => {
    const id = await resolveProjectId(projectId);
    const data = await request(
      `
        query RailwayProject($id: String!) {
          project(id: $id) {
            id
            name
            prDeploys
            focusedPrEnvironments
            botPrEnvironments
            baseEnvironmentId
            primaryEnvironmentId
            workspace {
              id
              name
            }
            environments {
              edges {
                node {
                  id
                  name
                  isEphemeral
                  canAccess
                  projectId
                }
              }
            }
            services {
              edges {
                node {
                  id
                  name
                }
              }
            }
          }
        }
      `,
      { id },
    );

    return {
      ...data.project,
      environments: connectionNodes(data.project.environments),
      services: connectionNodes(data.project.services),
    };
  };

  const getProjectMembers = async (projectId) => {
    requireAccountToken("getRailwayProjectMembers");
    const id = await requireResolvedProjectId(projectId, "getRailwayProjectMembers");
    const data = await request(
      `
        query RailwayProjectMembers($projectId: String!) {
          projectMembers(projectId: $projectId) {
            id
            role
            user {
              name
              email
            }
          }
        }
      `,
      { projectId: id },
    );
    return data.projectMembers;
  };

  const listEnvironments = async ({ projectId, isEphemeral } = {}) => {
    const resolvedProjectId = await resolveProjectId(projectId);
    const data = await request(
      `
        query RailwayEnvironments($projectId: String!, $isEphemeral: Boolean) {
          environments(projectId: $projectId, isEphemeral: $isEphemeral) {
            edges {
              node {
                id
                name
                isEphemeral
                canAccess
                projectId
              }
            }
          }
        }
      `,
      { projectId: resolvedProjectId, isEphemeral },
    );
    return connectionNodes(data.environments);
  };

  const getEnvironment = async (environmentId) => {
    const data = await request(
      `
        query RailwayEnvironment($id: String!) {
          environment(id: $id) {
            id
            name
            isEphemeral
            canAccess
            projectId
            sourceEnvironment {
              id
              name
            }
            serviceInstances {
              edges {
                node {
                  id
                  environmentId
                  serviceId
                  serviceName
                  rootDirectory
                  railwayConfigFile
                  startCommand
                  healthcheckPath
                  latestDeployment {
                    id
                    status
                    url
                    staticUrl
                  }
                  domains {
                    serviceDomains {
                      domain
                    }
                    customDomains {
                      domain
                    }
                  }
                }
              }
            }
          }
        }
      `,
      { id: environmentId },
    );

    return {
      ...data.environment,
      serviceInstances: connectionNodes(data.environment.serviceInstances),
    };
  };

  const getService = async (serviceId) => {
    const data = await request(
      `
        query RailwayService($id: String!) {
          service(id: $id) {
            id
            name
            icon
            createdAt
            updatedAt
            deletedAt
            featureFlags
            project {
              id
              name
            }
          }
        }
      `,
      { id: serviceId },
    );
    return {
      ...data.service,
      projectId: data.service.project?.id ?? null,
      projectName: data.service.project?.name ?? null,
    };
  };

  const getServiceInstance = async ({ serviceId, environmentId }) => {
    const data = await request(
      `
        query RailwayServiceInstance($serviceId: String!, $environmentId: String!) {
          serviceInstance(serviceId: $serviceId, environmentId: $environmentId) {
            id
            serviceId
            serviceName
            environmentId
            rootDirectory
            railwayConfigFile
            buildCommand
            startCommand
            healthcheckPath
            cronSchedule
            latestDeployment {
              id
              status
              url
              staticUrl
            }
            domains {
              serviceDomains {
                id
                domain
              }
              customDomains {
                id
                domain
              }
            }
          }
        }
      `,
      { serviceId, environmentId },
    );
    return data.serviceInstance;
  };

  const getServiceInstanceLimits = async ({ serviceId, environmentId }) => {
    const data = await request(
      `
        query RailwayServiceInstanceLimits($serviceId: String!, $environmentId: String!) {
          serviceInstanceLimits(serviceId: $serviceId, environmentId: $environmentId)
        }
      `,
      { serviceId, environmentId },
    );
    return data.serviceInstanceLimits;
  };

  const getDeployment = async (deploymentId) => {
    const data = await request(
      `
        query RailwayDeployment($id: String!) {
          deployment(id: $id) {
            id
            status
            createdAt
            updatedAt
            statusUpdatedAt
            canRedeploy
            canRollback
            deploymentStopped
            environmentId
            projectId
            serviceId
            url
            staticUrl
            service {
              id
              name
            }
            environment {
              id
              name
            }
          }
        }
      `,
      { id: deploymentId },
    );
    return {
      ...data.deployment,
      serviceName: data.deployment.service?.name ?? null,
      environmentName: data.deployment.environment?.name ?? null,
    };
  };

  const listDeployments = async ({
    projectId,
    environmentId,
    serviceId,
    first = 20,
    after = null,
    before = null,
    last = null,
  } = {}) => {
    const resolvedProjectId =
      projectId == null && auth.kind === "project"
        ? await requireResolvedProjectId(null, "listRailwayDeployments")
        : projectId;

    const input = compactObject({
      projectId: resolvedProjectId,
      environmentId,
      serviceId,
    });

    const data = await request(
      `
        query RailwayDeployments(
          $input: DeploymentListInput!
          $first: Int
          $after: String
          $before: String
          $last: Int
        ) {
          deployments(
            input: $input
            first: $first
            after: $after
            before: $before
            last: $last
          ) {
            edges {
              node {
                id
                status
                createdAt
                updatedAt
                environmentId
                projectId
                serviceId
                url
                staticUrl
              }
            }
            pageInfo {
              hasNextPage
              hasPreviousPage
              startCursor
              endCursor
            }
          }
        }
      `,
      { input, first, after, before, last },
    );

    return {
      deployments: connectionNodes(data.deployments),
      pageInfo: data.deployments?.pageInfo ?? null,
    };
  };

  const createProject = async (input = {}) => {
    requireAccountToken("createRailwayProject");
    const data = await request(
      `
        mutation RailwayProjectCreate($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
            description
            workspace {
              id
              name
            }
          }
        }
      `,
      { input: compactObject(input) },
    );
    return data.projectCreate;
  };

  const updateProject = async ({ projectId, ...input } = {}) => {
    requireAccountToken("updateRailwayProject");
    const id = await requireResolvedProjectId(projectId, "updateRailwayProject");
    const data = await request(
      `
        mutation RailwayProjectUpdate($id: String!, $input: ProjectUpdateInput!) {
          projectUpdate(id: $id, input: $input) {
            id
            name
            description
            prDeploys
            focusedPrEnvironments
            botPrEnvironments
            isPublic
          }
        }
      `,
      { id, input: compactObject(input) },
    );
    return data.projectUpdate;
  };

  const deleteProject = async (projectId) => {
    requireAccountToken("deleteRailwayProject");
    const id = await requireResolvedProjectId(projectId, "deleteRailwayProject");
    const deleted = await request(
      `
        mutation RailwayProjectDelete($id: String!) {
          projectDelete(id: $id)
        }
      `,
      { id },
    );
    return {
      deleted: Boolean(deleted.projectDelete),
      projectId: id,
    };
  };

  const transferProject = async ({ projectId, workspaceId } = {}) => {
    requireAccountToken("transferRailwayProject");
    const id = await requireResolvedProjectId(projectId, "transferRailwayProject");
    const transferred = await request(
      `
        mutation RailwayProjectTransfer($projectId: String!, $input: ProjectTransferInput!) {
          projectTransfer(projectId: $projectId, input: $input)
        }
      `,
      {
        projectId: id,
        input: { workspaceId },
      },
    );
    return {
      transferred: Boolean(transferred.projectTransfer),
      projectId: id,
      workspaceId,
    };
  };

  const createService = async (input = {}) => {
    const data = await request(
      `
        mutation RailwayServiceCreate($input: ServiceCreateInput!) {
          serviceCreate(input: $input) {
            id
            name
            icon
            projectId
          }
        }
      `,
      { input: compactObject(input) },
    );
    return data.serviceCreate;
  };

  const updateService = async ({ serviceId, ...input } = {}) => {
    const data = await request(
      `
        mutation RailwayServiceUpdate($id: String!, $input: ServiceUpdateInput!) {
          serviceUpdate(id: $id, input: $input) {
            id
            name
            icon
            projectId
          }
        }
      `,
      { id: serviceId, input: compactObject(input) },
    );
    return data.serviceUpdate;
  };

  const connectService = async ({ serviceId, ...input } = {}) => {
    const data = await request(
      `
        mutation RailwayServiceConnect($id: String!, $input: ServiceConnectInput!) {
          serviceConnect(id: $id, input: $input) {
            id
            name
            icon
            projectId
          }
        }
      `,
      { id: serviceId, input: compactObject(input) },
    );
    return data.serviceConnect;
  };

  const disconnectService = async (serviceId) => {
    const disconnected = await request(
      `
        mutation RailwayServiceDisconnect($id: String!) {
          serviceDisconnect(id: $id)
        }
      `,
      { id: serviceId },
    );
    return {
      disconnected: Boolean(disconnected.serviceDisconnect),
      serviceId,
    };
  };

  const deleteService = async ({ serviceId, environmentId } = {}) => {
    const deleted = await request(
      `
        mutation RailwayServiceDelete($id: String!, $environmentId: String) {
          serviceDelete(id: $id, environmentId: $environmentId)
        }
      `,
      { id: serviceId, environmentId },
    );
    return {
      deleted: Boolean(deleted.serviceDelete),
      serviceId,
      environmentId: environmentId ?? null,
    };
  };

  const updateServiceInstance = async ({
    serviceId,
    environmentId,
    ...input
  } = {}) => {
    const updated = await request(
      `
        mutation RailwayServiceInstanceUpdate(
          $serviceId: String!
          $environmentId: String
          $input: ServiceInstanceUpdateInput!
        ) {
          serviceInstanceUpdate(
            serviceId: $serviceId
            environmentId: $environmentId
            input: $input
          )
        }
      `,
      {
        serviceId,
        environmentId,
        input: compactObject(input),
      },
    );
    return {
      updated: Boolean(updated.serviceInstanceUpdate),
      serviceId,
      environmentId: environmentId ?? null,
    };
  };

  const deployService = async ({
    serviceId,
    environmentId,
    commitSha,
    latestCommit,
  } = {}) => {
    const deployment = await request(
      `
        mutation RailwayServiceInstanceDeploy(
          $serviceId: String!
          $environmentId: String!
          $commitSha: String
          $latestCommit: Boolean
        ) {
          serviceInstanceDeploy(
            serviceId: $serviceId
            environmentId: $environmentId
            commitSha: $commitSha
            latestCommit: $latestCommit
          ) {
            id
            status
            environmentId
            serviceId
            url
            staticUrl
          }
        }
      `,
      { serviceId, environmentId, commitSha, latestCommit },
    );
    return deployment.serviceInstanceDeploy;
  };

  const redeployService = async ({ serviceId, environmentId } = {}) => {
    const deployment = await request(
      `
        mutation RailwayServiceInstanceRedeploy(
          $serviceId: String!
          $environmentId: String!
        ) {
          serviceInstanceRedeploy(
            serviceId: $serviceId
            environmentId: $environmentId
          ) {
            id
            status
            environmentId
            serviceId
            url
            staticUrl
          }
        }
      `,
      { serviceId, environmentId },
    );
    return deployment.serviceInstanceRedeploy;
  };

  const updateServiceInstanceLimits = async ({
    serviceId,
    environmentId,
    memoryGB,
    vCPUs,
  } = {}) => {
    const updated = await request(
      `
        mutation RailwayServiceInstanceLimitsUpdate(
          $input: ServiceInstanceLimitsUpdateInput!
        ) {
          serviceInstanceLimitsUpdate(input: $input)
        }
      `,
      {
        input: compactObject({
          serviceId,
          environmentId,
          memoryGB,
          vCPUs,
        }),
      },
    );
    return {
      updated: Boolean(updated.serviceInstanceLimitsUpdate),
      serviceId,
      environmentId,
      memoryGB: memoryGB ?? null,
      vCPUs: vCPUs ?? null,
    };
  };

  const createEnvironment = async (input = {}) => {
    const environment = await request(
      `
        mutation RailwayEnvironmentCreate($input: EnvironmentCreateInput!) {
          environmentCreate(input: $input) {
            id
            name
            isEphemeral
            projectId
          }
        }
      `,
      { input: compactObject(input) },
    );
    return environment.environmentCreate;
  };

  const deleteEnvironment = async (environmentId) => {
    const deleted = await request(
      `
        mutation RailwayEnvironmentDelete($id: String!) {
          environmentDelete(id: $id)
        }
      `,
      { id: environmentId },
    );
    return {
      deleted: Boolean(deleted.environmentDelete),
      environmentId,
    };
  };

  const upsertVariable = async (input = {}) => {
    const updated = await request(
      `
        mutation RailwayVariableUpsert($input: VariableUpsertInput!) {
          variableUpsert(input: $input)
        }
      `,
      { input: compactObject(input) },
    );
    return {
      updated: Boolean(updated.variableUpsert),
      name: input.name ?? null,
      environmentId: input.environmentId ?? null,
      serviceId: input.serviceId ?? null,
      projectId: input.projectId ?? null,
    };
  };

  const deleteVariable = async (input = {}) => {
    const deleted = await request(
      `
        mutation RailwayVariableDelete($input: VariableDeleteInput!) {
          variableDelete(input: $input)
        }
      `,
      { input: compactObject(input) },
    );
    return {
      deleted: Boolean(deleted.variableDelete),
      name: input.name ?? null,
      environmentId: input.environmentId ?? null,
      serviceId: input.serviceId ?? null,
      projectId: input.projectId ?? null,
    };
  };

  const createServiceDomain = async (input = {}) => {
    const domain = await request(
      `
        mutation RailwayServiceDomainCreate($input: ServiceDomainCreateInput!) {
          serviceDomainCreate(input: $input) {
            id
            domain
          }
        }
      `,
      { input: compactObject(input) },
    );
    return domain.serviceDomainCreate;
  };

  const updateServiceDomain = async (input = {}) => {
    const updated = await request(
      `
        mutation RailwayServiceDomainUpdate($input: ServiceDomainUpdateInput!) {
          serviceDomainUpdate(input: $input)
        }
      `,
      { input: compactObject(input) },
    );
    return {
      updated: Boolean(updated.serviceDomainUpdate),
      serviceDomainId: input.serviceDomainId ?? null,
    };
  };

  const deleteServiceDomain = async (serviceDomainId) => {
    const deleted = await request(
      `
        mutation RailwayServiceDomainDelete($id: String!) {
          serviceDomainDelete(id: $id)
        }
      `,
      { id: serviceDomainId },
    );
    return {
      deleted: Boolean(deleted.serviceDomainDelete),
      serviceDomainId,
    };
  };

  const createCustomDomain = async (input = {}) => {
    const domain = await request(
      `
        mutation RailwayCustomDomainCreate($input: CustomDomainCreateInput!) {
          customDomainCreate(input: $input) {
            id
            domain
          }
        }
      `,
      { input: compactObject(input) },
    );
    return domain.customDomainCreate;
  };

  const updateCustomDomain = async ({
    customDomainId,
    environmentId,
    targetPort,
  } = {}) => {
    const updated = await request(
      `
        mutation RailwayCustomDomainUpdate(
          $id: String!
          $environmentId: String!
          $targetPort: Int
        ) {
          customDomainUpdate(
            id: $id
            environmentId: $environmentId
            targetPort: $targetPort
          )
        }
      `,
      { id: customDomainId, environmentId, targetPort },
    );
    return {
      updated: Boolean(updated.customDomainUpdate),
      customDomainId,
    };
  };

  const deleteCustomDomain = async (customDomainId) => {
    const deleted = await request(
      `
        mutation RailwayCustomDomainDelete($id: String!) {
          customDomainDelete(id: $id)
        }
      `,
      { id: customDomainId },
    );
    return {
      deleted: Boolean(deleted.customDomainDelete),
      customDomainId,
    };
  };

  const createVolume = async (input = {}) => {
    const volume = await request(
      `
        mutation RailwayVolumeCreate($input: VolumeCreateInput!) {
          volumeCreate(input: $input) {
            id
          }
        }
      `,
      { input: compactObject(input) },
    );
    return volume.volumeCreate;
  };

  const deleteVolume = async (volumeId) => {
    const deleted = await request(
      `
        mutation RailwayVolumeDelete($volumeId: String!) {
          volumeDelete(volumeId: $volumeId)
        }
      `,
      { volumeId },
    );
    return {
      deleted: Boolean(deleted.volumeDelete),
      volumeId,
    };
  };

  const doctorProject = async ({ projectId } = {}) => {
    const project = await getProject(projectId);
    const primaryEnvironmentId =
      project.primaryEnvironmentId ??
      project.baseEnvironmentId ??
      project.environments.find((entry) => entry.name.toLowerCase() === "production")
        ?.id;

    if (!primaryEnvironmentId) {
      throw new RailwayApiError(
        `Could not resolve primary Railway environment for ${project.name}.`,
      );
    }

    const environment = await getEnvironment(primaryEnvironmentId);
    return {
      project: {
        id: project.id,
        name: project.name,
        workspace: project.workspace?.name ?? null,
      },
      environment: {
        id: environment.id,
        name: environment.name,
        isEphemeral: environment.isEphemeral,
      },
      services: environment.serviceInstances.map((entry) => ({
        serviceId: entry.serviceId,
        serviceName: entry.serviceName,
        railwayConfigFile: entry.railwayConfigFile ?? null,
        rootDirectory: entry.rootDirectory ?? null,
        startCommand: entry.startCommand ?? null,
        healthcheckPath: entry.healthcheckPath ?? null,
        deployment: entry.latestDeployment
          ? {
              id: entry.latestDeployment.id,
              status: entry.latestDeployment.status,
              url: entry.latestDeployment.url ?? null,
              staticUrl: entry.latestDeployment.staticUrl ?? null,
            }
          : null,
        customDomains:
          entry.domains?.customDomains?.map((item) => item.domain) ?? [],
        serviceDomains:
          entry.domains?.serviceDomains?.map((item) => item.domain) ?? [],
      })),
    };
  };

  return {
    auth,
    endpoint,
    getAuthStatus: () => getRailwayAuthStatus(env),
    getCurrentViewer,
    validateAccountToken,
    listProjects,
    createProject,
    updateProject,
    deleteProject,
    transferProject,
    getProjectMembers,
    getProjectTokenContext,
    getProject,
    listEnvironments,
    getEnvironment,
    createEnvironment,
    deleteEnvironment,
    getService,
    getServiceInstance,
    getServiceInstanceLimits,
    createService,
    updateService,
    connectService,
    disconnectService,
    deleteService,
    updateServiceInstance,
    deployService,
    redeployService,
    updateServiceInstanceLimits,
    getDeployment,
    listDeployments,
    upsertVariable,
    deleteVariable,
    createServiceDomain,
    updateServiceDomain,
    deleteServiceDomain,
    createCustomDomain,
    updateCustomDomain,
    deleteCustomDomain,
    createVolume,
    deleteVolume,
    doctorProject,
  };
};

const connectionNodes = (connection) => {
  const nodes = [];
  for (const entry of connection?.edges ?? []) {
    if (entry.node != null) {
      nodes.push(entry.node);
    }
  }
  return nodes;
};

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  );

const hasErrors = (payload) =>
  typeof payload === "object" &&
  payload !== null &&
  "errors" in payload &&
  Array.isArray(payload.errors);

const formatRailwayErrorMessage = (payload, status) => {
  if (hasErrors(payload)) {
    const joined = payload.errors
      .map((entry) => entry?.message?.trim())
      .filter(Boolean)
      .join(" | ");
    if (joined) {
      return joined;
    }
  }

  return `Railway API request failed with HTTP ${status}`;
};
