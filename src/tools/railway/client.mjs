import {
	DEFAULT_RAILWAY_API_ENDPOINT,
	getRailwayAuthStatus,
	getRailwayBootstrapToken,
	resolveRailwayApiToken,
} from "./auth.mjs";

export {
	getRailwayAuthStatus,
	getRailwayBootstrapToken,
	resolveRailwayApiToken,
} from "./auth.mjs";

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
				error instanceof Error
					? error.message
					: `${operation} requires a Railway project id.`,
			);
		}
	};

	const resolveProjectSelector = async ({
		projectId,
		projectName,
		operation,
	} = {}) => {
		const explicitProjectId = projectId?.trim();
		if (explicitProjectId) {
			return {
				projectId: explicitProjectId,
				project: null,
			};
		}

		const defaultProjectId = status.defaultProjectId?.trim();
		if (defaultProjectId) {
			return {
				projectId: defaultProjectId,
				project: null,
			};
		}

		const requestedProjectName = pickString(projectName);

		if (auth.kind === "project") {
			const context = await getProjectTokenContext();
			if (
				requestedProjectName &&
				!matchesSelector(context.project?.name, requestedProjectName)
			) {
				throw new RailwayApiError(
					`${operation} could not find a matching project for "${requestedProjectName}". The current Railway project token is scoped to "${context.project?.name ?? context.projectId}".`,
				);
			}
			return {
				projectId: context.projectId,
				project: context.project ?? null,
			};
		}

		const projects = await listProjects({
			includeDeleted: false,
			first: 100,
		});
		const resolved = resolveSingleNamedResource({
			items: projects,
			requestedName: requestedProjectName,
			getId: (project) => project.id,
			getLabel: (project) => project.name,
			resourceLabel: "project",
			operation,
		});

		if (resolved) {
			return {
				projectId: resolved.id,
				project: projects.find((project) => project.id === resolved.id) ?? null,
			};
		}

		throw new RailwayApiError(
			`${operation} requires a Railway project. Pass projectId, pass projectName, set RAILWAY_PROJECT_ID, or use RAILWAY_PROJECT_TOKEN.`,
		);
	};

	const resolveEnvironmentSelector = async ({
		projectId,
		projectName,
		environmentId,
		environmentName,
		operation,
	} = {}) => {
		const explicitEnvironmentId = pickString(environmentId);
		if (explicitEnvironmentId) {
			return {
				environmentId: explicitEnvironmentId,
				projectId:
					pickString(projectId) ??
					status.defaultProjectId?.trim() ??
					(auth.kind === "project"
						? (await getProjectTokenContext()).projectId
						: null),
				environment: null,
				project: null,
			};
		}

		const projectSelection = await resolveProjectSelector({
			projectId,
			projectName,
			operation,
		});
		const project = await getProject(projectSelection.projectId);
		const environments = project.environments ?? [];
		const requestedEnvironmentName = pickString(environmentName);
		const resolved = resolveSingleNamedResource({
			items: environments,
			requestedName: requestedEnvironmentName,
			getId: (environment) => environment.id,
			getLabel: (environment) => environment.name,
			resourceLabel: "environment",
			operation,
			fallbackResolver: (items) => {
				if (items.length === 1) {
					return items[0];
				}

				const preferred =
					items.find((item) => item.id === project.primaryEnvironmentId) ??
					items.find((item) => item.id === project.baseEnvironmentId) ??
					items.find((item) => normalizeSelector(item.name) === "production");

				return preferred ?? null;
			},
		});

		if (resolved) {
			return {
				environmentId: resolved.id,
				projectId: project.id,
				environment:
					environments.find((environment) => environment.id === resolved.id) ??
					null,
				project,
			};
		}

		throw new RailwayApiError(
			`${operation} requires a Railway environment. Pass environmentId or environmentName.`,
		);
	};

	const resolveServiceSelector = async ({
		projectId,
		projectName,
		environmentId,
		environmentName,
		serviceId,
		serviceName,
		operation,
	} = {}) => {
		const explicitServiceId = pickString(serviceId);
		const requestedServiceName = pickString(serviceName);

		if (explicitServiceId) {
			const environmentSelection =
				pickString(environmentId) || pickString(environmentName)
					? await resolveEnvironmentSelector({
							projectId,
							projectName,
							environmentId,
							environmentName,
							operation,
						})
					: null;

			return {
				serviceId: explicitServiceId,
				service: null,
				environment: environmentSelection?.environment ?? null,
				environmentId:
					environmentSelection?.environmentId ??
					pickString(environmentId) ??
					null,
				project: environmentSelection?.project ?? null,
				projectId:
					environmentSelection?.projectId ??
					pickString(projectId) ??
					status.defaultProjectId?.trim() ??
					null,
			};
		}

		if (pickString(environmentId) || pickString(environmentName)) {
			const environmentSelection = await resolveEnvironmentSelector({
				projectId,
				projectName,
				environmentId,
				environmentName,
				operation,
			});
			const environmentDetail = await getEnvironment(
				environmentSelection.environmentId,
			);
			const services = (environmentDetail.serviceInstances ?? []).map(
				(entry) => ({
					id: entry.serviceId,
					name: entry.serviceName,
				}),
			);
			const resolved = resolveSingleNamedResource({
				items: services,
				requestedName: requestedServiceName,
				getId: (service) => service.id,
				getLabel: (service) => service.name,
				resourceLabel: "service",
				operation,
			});

			if (resolved) {
				return {
					serviceId: resolved.id,
					service:
						services.find((service) => service.id === resolved.id) ?? null,
					environment: environmentSelection.environment,
					environmentId: environmentSelection.environmentId,
					project: environmentSelection.project,
					projectId: environmentSelection.projectId,
				};
			}
		}

		const projectSelection = await resolveProjectSelector({
			projectId,
			projectName,
			operation,
		});
		const project = await getProject(projectSelection.projectId);
		const services = project.services ?? [];
		const resolved = resolveSingleNamedResource({
			items: services,
			requestedName: requestedServiceName,
			getId: (service) => service.id,
			getLabel: (service) => service.name,
			resourceLabel: "service",
			operation,
		});

		if (resolved) {
			return {
				serviceId: resolved.id,
				service: services.find((service) => service.id === resolved.id) ?? null,
				environment: null,
				environmentId: null,
				project,
				projectId: project.id,
			};
		}

		throw new RailwayApiError(
			`${operation} requires a Railway service. Pass serviceId or serviceName.`,
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
		const id = await requireResolvedProjectId(
			projectId,
			"getRailwayProjectMembers",
		);
		const data = await request(
			`
        query RailwayProjectMembers($projectId: String!) {
          projectMembers(projectId: $projectId) {
            id
            role
            name
            email
            avatar
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
		const id = await requireResolvedProjectId(
			projectId,
			"updateRailwayProject",
		);
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
		const id = await requireResolvedProjectId(
			projectId,
			"deleteRailwayProject",
		);
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
		const id = await requireResolvedProjectId(
			projectId,
			"transferRailwayProject",
		);
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
		const data = await request(
			`
        mutation RailwayServiceDisconnect($id: String!) {
          serviceDisconnect(id: $id) {
            id
            name
            icon
            projectId
          }
        }
      `,
			{ id: serviceId },
		);
		return data.serviceDisconnect;
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
          )
        }
      `,
			{ serviceId, environmentId, commitSha, latestCommit },
		);
		return {
			triggered: Boolean(deployment.serviceInstanceDeploy),
			serviceId,
			environmentId,
			commitSha: commitSha ?? null,
			latestCommit: latestCommit ?? null,
		};
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
          )
        }
      `,
			{ serviceId, environmentId },
		);
		return {
			triggered: Boolean(deployment.serviceInstanceRedeploy),
			serviceId,
			environmentId,
		};
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

	const listVariables = async (input = {}) => {
		const { projectId, environmentId, serviceId } = input;
		if (!projectId || !environmentId) {
			throw new RailwayApiError(
				"listVariables requires projectId and environmentId.",
			);
		}
		const data = await request(
			`
        query RailwayVariables(
          $projectId: String!
          $environmentId: String!
          $serviceId: String
        ) {
          variables(
            projectId: $projectId
            environmentId: $environmentId
            serviceId: $serviceId
          )
        }
      `,
			compactObject({ projectId, environmentId, serviceId }),
		);
		const variables = data.variables ?? {};
		return {
			projectId,
			environmentId,
			serviceId: serviceId ?? null,
			// Service-scoped when serviceId is set; otherwise shared/environment vars.
			scope: serviceId ? "service" : "environment",
			count: Object.keys(variables).length,
			variables,
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
            status {
              cdnProvider
              certificateStatus
              dnsRecords {
                hostlabel
                fqdn
                purpose
                recordType
                requiredValue
                currentValue
                status
              }
              verificationDnsHost
            }
          }
        }
      `,
			{ input: compactObject(input) },
		);
		const created = domain.customDomainCreate ?? {};

		// Surface the required DNS records front-and-center. Railway needs BOTH:
		//   1. A CNAME at the domain pointing to a rotating short hostname
		//      (status.dnsRecords[].requiredValue when purpose === "TRAFFIC_ROUTING")
		//   2. A TXT record at `_railway-verify.<subdomain>` for ownership
		//      proof (status.verificationDnsHost when present)
		//
		// Both must exist before Railway will issue a TLS cert. This was a
		// 30-minute footgun in zeroframe test #2 — the wrapper now surfaces them.
		const requiredDnsRecords = buildRequiredDnsRecords(created);

		return {
			...created,
			requiredDnsRecords,
		};
	};

	const getCustomDomain = async (customDomainId) => {
		if (!customDomainId) {
			throw new RailwayApiError("getCustomDomain requires customDomainId.");
		}
		const data = await request(
			`
        query RailwayCustomDomain($id: String!) {
          customDomain(id: $id) {
            id
            domain
            environmentId
            projectId
            status {
              cdnProvider
              certificateStatus
              dnsRecords {
                hostlabel
                fqdn
                purpose
                recordType
                requiredValue
                currentValue
                status
              }
              verificationDnsHost
            }
          }
        }
      `,
			{ id: customDomainId },
		);
		const domain = data.customDomain ?? null;
		if (!domain) {
			throw new RailwayApiError(`Custom domain ${customDomainId} not found.`);
		}
		return {
			...domain,
			requiredDnsRecords: buildRequiredDnsRecords(domain),
		};
	};

	const waitForCustomDomain = async ({
		customDomainId,
		timeoutMs = 600_000,
		pollIntervalMs = 5_000,
	} = {}) => {
		const start = Date.now();
		let lastStatus = null;
		while (Date.now() - start < timeoutMs) {
			const domain = await getCustomDomain(customDomainId);
			lastStatus = domain.status?.certificateStatus;
			if (lastStatus === "CERTIFICATE_STATUS_TYPE_VALID") {
				return {
					ok: true,
					customDomainId,
					domain,
					waitedMs: Date.now() - start,
				};
			}
			if (
				lastStatus === "CERTIFICATE_STATUS_TYPE_FAILED" ||
				lastStatus === "CERTIFICATE_STATUS_TYPE_REVOKED"
			) {
				throw new RailwayApiError(
					`Custom domain cert reached terminal failure state: ${lastStatus}. Inspect via getCustomDomain.`,
					{ status: 400, errors: [{ message: lastStatus }] },
				);
			}
			await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
		}
		throw new RailwayApiError(
			`Custom domain cert did not reach VALID within ${timeoutMs}ms (last status: ${lastStatus}). Check DNS records via getCustomDomain.`,
			{ status: 504, errors: [{ message: "wait timeout" }] },
		);
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
			project.environments.find(
				(entry) => entry.name.toLowerCase() === "production",
			)?.id;

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
		resolveProjectSelector,
		createProject,
		updateProject,
		deleteProject,
		transferProject,
		getProjectMembers,
		getProjectTokenContext,
		getProject,
		listEnvironments,
		resolveEnvironmentSelector,
		getEnvironment,
		createEnvironment,
		deleteEnvironment,
		getService,
		resolveServiceSelector,
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
		listVariables,
		createServiceDomain,
		updateServiceDomain,
		deleteServiceDomain,
		createCustomDomain,
		getCustomDomain,
		waitForCustomDomain,
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

const pickString = (...values) => {
	for (const value of values) {
		if (typeof value === "string" && value.trim().length > 0) {
			return value.trim();
		}
	}
	return null;
};

const normalizeSelector = (value) =>
	String(value ?? "")
		.trim()
		.toLowerCase();

const matchesSelector = (candidate, requested) => {
	const wanted = normalizeSelector(requested);
	if (!wanted) {
		return true;
	}

	const value = normalizeSelector(candidate);
	return value.includes(wanted);
};

const resolveSingleNamedResource = ({
	items,
	requestedName,
	getId,
	getLabel,
	resourceLabel,
	operation,
	fallbackResolver,
}) => {
	const collection = Array.isArray(items) ? items : [];

	if (collection.length === 0) {
		return null;
	}

	if (!requestedName) {
		if (collection.length === 1) {
			return {
				id: getId(collection[0]),
				label: getLabel(collection[0]),
			};
		}

		const fallback =
			typeof fallbackResolver === "function"
				? fallbackResolver(collection)
				: null;
		if (fallback) {
			return {
				id: getId(fallback),
				label: getLabel(fallback),
			};
		}

		throw new RailwayApiError(
			`${operation} matched multiple ${resourceLabel}s — pass an explicit ${resourceLabel} id or name to choose one. Accessible: ${collection
				.slice(0, 10)
				.map((item) => getLabel(item))
				.join(", ")}.`,
		);
	}

	const exactMatches = collection.filter(
		(item) =>
			normalizeSelector(getLabel(item)) === normalizeSelector(requestedName),
	);

	if (exactMatches.length === 1) {
		return {
			id: getId(exactMatches[0]),
			label: getLabel(exactMatches[0]),
		};
	}

	const fuzzyMatches = collection.filter((item) =>
		matchesSelector(getLabel(item), requestedName),
	);

	if (fuzzyMatches.length === 1) {
		return {
			id: getId(fuzzyMatches[0]),
			label: getLabel(fuzzyMatches[0]),
		};
	}

	if (exactMatches.length > 1 || fuzzyMatches.length > 1) {
		const matches = (exactMatches.length > 1 ? exactMatches : fuzzyMatches)
			.slice(0, 10)
			.map((item) => getLabel(item))
			.join(", ");

		throw new RailwayApiError(
			`${operation} found multiple matching ${resourceLabel}s for "${requestedName}": ${matches}. Use the explicit ${resourceLabel} id if needed.`,
		);
	}

	throw new RailwayApiError(
		`${operation} could not find a matching ${resourceLabel} for "${requestedName}".`,
	);
};

const hasErrors = (payload) =>
	typeof payload === "object" &&
	payload !== null &&
	"errors" in payload &&
	Array.isArray(payload.errors);

/**
 * Build a flat array of DNS records the user MUST add to the domain registrar
 * before Railway will issue a TLS cert. Pulls from BOTH:
 *   - status.dnsRecords[] (the routing CNAME — rotates on every recreate)
 *   - status.verificationDnsHost (the _railway-verify TXT for ownership proof)
 *
 * Returns: [{ type, name, value, purpose }] in a stable order suitable for
 * printing directly to the user.
 */
const buildRequiredDnsRecords = (customDomain) => {
	const status = customDomain?.status ?? {};
	const records = [];

	// 1. The rotating CNAME (when status.dnsRecords[].requiredValue is set).
	for (const r of status.dnsRecords ?? []) {
		if (!r?.requiredValue) continue;
		records.push({
			type: r.recordType ?? "CNAME",
			name: r.fqdn ?? r.hostlabel ?? customDomain?.domain ?? "<domain>",
			value: r.requiredValue,
			purpose: r.purpose ?? "TRAFFIC_ROUTING",
			currentValue: r.currentValue ?? null,
			status: r.status ?? null,
		});
	}

	// 2. The TXT verification record.
	if (status.verificationDnsHost) {
		const fqdn = customDomain?.domain ?? "";
		// Railway docs show the TXT lives at `_railway-verify.<subdomain>` but the
		// host they return in verificationDnsHost is the full short form. We
		// surface what Railway returns plus a guess at the host label.
		records.push({
			type: "TXT",
			name: fqdn
				? `_railway-verify.${fqdn.split(".")[0]}.${fqdn.split(".").slice(1).join(".")}`
				: "_railway-verify.<subdomain>",
			value: status.verificationDnsHost,
			purpose: "DOMAIN_VERIFICATION",
		});
	}

	return records;
};

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

// =============================================================================
// Bootstrap client — global account-token, used only at project-create time
// =============================================================================
//
// Mirrors the Cloudflare bootstrap pattern. The bootstrap is an account-level
// Railway token (broad reach across workspaces). It is used to list
// workspaces/projects and to mint project-scoped working tokens via
// projectTokenCreate. Working tokens are written per-project to
// .zeroframe/credentials/railway.json so each zeroframe project carries
// credentials scoped to one Railway project.

export const createRailwayBootstrapClient = ({
	env = process.env,
	fetchImpl = globalThis.fetch,
} = {}) => {
	const bootstrap = getRailwayBootstrapToken(env);
	const endpoint =
		String(env.RAILWAY_API_ENDPOINT ?? DEFAULT_RAILWAY_API_ENDPOINT) ||
		DEFAULT_RAILWAY_API_ENDPOINT;

	if (typeof fetchImpl !== "function") {
		throw new Error(
			"Railway bootstrap client requires a fetch implementation.",
		);
	}

	const request = async (query, variables = {}) => {
		if (!bootstrap.token) {
			throw new RailwayApiError(
				"Missing Railway bootstrap token. Run `bun zero connect railway` once per machine to create one.",
			);
		}
		const response = await fetchImpl(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				Authorization: `Bearer ${bootstrap.token}`,
			},
			body: JSON.stringify({ query, variables }),
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

	/**
	 * List the workspaces this bootstrap token can see. Used by the orchestrator
	 * (bun zero infra create railway) to ask the user where the new Railway
	 * project should live.
	 */
	const listWorkspaces = async () => {
		const data = await request(`
      query RailwayBootstrapWorkspaces {
        me {
          name
          email
          workspaces { id name }
        }
      }
    `);
		return {
			me: data.me,
			workspaces: data.me?.workspaces ?? [],
		};
	};

	/**
	 * List projects the bootstrap token can see across all workspaces (or
	 * scoped to one). Used to verify project existence after create + to allow
	 * minting working tokens for pre-existing projects.
	 */
	const listProjects = async ({ workspaceId = null, first = 100 } = {}) => {
		const data = await request(
			`
        query RailwayBootstrapProjects($workspaceId: String, $first: Int) {
          projects(workspaceId: $workspaceId, first: $first) {
            edges {
              node {
                id
                name
                workspace { id name }
                createdAt
              }
            }
          }
        }
      `,
			{ workspaceId, first },
		);
		return (data.projects?.edges ?? []).map((edge) => edge.node);
	};

	/**
	 * Mint a project-scoped working token via Railway's projectTokenCreate
	 * mutation. Returns the raw token string. The CALLER stores it in the
	 * project credential file.
	 */
	const mintProjectToken = async ({ projectId, environmentId, name } = {}) => {
		if (!projectId) {
			throw new RailwayApiError(
				"mintProjectToken requires projectId. Run listProjects first to discover ids.",
			);
		}
		const data = await request(
			`
        mutation RailwayProjectTokenCreate($input: ProjectTokenCreateInput!) {
          projectTokenCreate(input: $input)
        }
      `,
			{
				input: {
					projectId,
					...(environmentId ? { environmentId } : {}),
					name: name ?? `zero-frame-${projectId.slice(0, 8)}-${Date.now()}`,
				},
			},
		);
		const tokenValue = data?.projectTokenCreate;
		if (!tokenValue || typeof tokenValue !== "string") {
			throw new RailwayApiError(
				"Railway did not return a project token value.",
				{ payload: data },
			);
		}
		return {
			tokenValue,
			projectId,
			environmentId: environmentId ?? null,
			name: name ?? null,
		};
	};

	return {
		bootstrap,
		endpoint,
		listWorkspaces,
		listProjects,
		mintProjectToken,
	};
};
