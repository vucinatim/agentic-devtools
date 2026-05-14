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
    listProjects,
    getProjectTokenContext,
    getProject,
    listEnvironments,
    getEnvironment,
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
