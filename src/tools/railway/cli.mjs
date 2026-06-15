import { createRailwayClient, RailwayApiError } from "./client.mjs";

export const railwayCliUsage = () => `Usage:
  agentic-devtools railway list-projects [--workspace-id <id>] [--include-deleted]
  agentic-devtools railway create-project --name <name> [--workspace-id <id>] [--description <text>] [--input-json <json>]
  agentic-devtools railway get-project [--project-id <id> | --project-name <name>]
  agentic-devtools railway update-project [--project-id <id> | --project-name <name>] [--name <name>] [--description <text>] [--input-json <json>]
  agentic-devtools railway delete-project [--project-id <id> | --project-name <name>]
  agentic-devtools railway transfer-project [--project-id <id> | --project-name <name>] --workspace-id <id>
  agentic-devtools railway get-project-members [--project-id <id> | --project-name <name>]
  agentic-devtools railway doctor [--project-id <id> | --project-name <name>]
  agentic-devtools railway list-environments [--project-id <id> | --project-name <name>] [--is-ephemeral <true|false>]
  agentic-devtools railway create-environment [--project-id <id> | --project-name <name>] --name <name> [--ephemeral] [--source-environment-id <id> | --source-environment-name <name>] [--input-json <json>]
  agentic-devtools railway get-environment [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>]
  agentic-devtools railway delete-environment [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>]
  agentic-devtools railway list-services [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>]
  agentic-devtools railway create-service [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>] [--name <name>] [--icon <icon>] [--source-json <json>] [--variables-json <json>] [--input-json <json>]
  agentic-devtools railway get-service [--project-id <id> | --project-name <name>] [--environment-id <id> | --environment-name <name>] [--service-id <id> | --service-name <name>]
  agentic-devtools railway delete-service [selectors...]
  agentic-devtools railway get-service-instance [selectors...]
  agentic-devtools railway get-service-instance-limits [selectors...]
  agentic-devtools railway list-deployments [selectors...]
  agentic-devtools railway get-deployment --deployment-id <id>
  agentic-devtools railway update-service [selectors...] [--name <name>] [--icon <icon>] [--input-json <json>]
  agentic-devtools railway connect-service [selectors...] [--repo <repo>] [--branch <branch>] [--image <image>] [--input-json <json>]
  agentic-devtools railway disconnect-service [selectors...]
  agentic-devtools railway update-instance [selectors...] [--watch-pattern <pattern> ...] [--root-directory <dir>] [--railway-config-file <file>] [--input-json <json>]
  agentic-devtools railway set-instance-limits [selectors...] [--memory-gb <number>] [--v-cpus <number>]
  agentic-devtools railway deploy [selectors...] [--commit-sha <sha>] [--latest-commit]
  agentic-devtools railway redeploy [selectors...]
  agentic-devtools railway set-variable [selectors...] --name <name> --value <value> [--skip-deploys]
  agentic-devtools railway delete-variable [selectors...] --name <name>
  agentic-devtools railway list-variables [selectors...]
  agentic-devtools railway create-service-domain [selectors...] [--target-port <port>] [--input-json <json>]
  agentic-devtools railway update-service-domain [selectors...] [--domain <domain>] [--service-domain-id <id>] [--target-port <port>]
  agentic-devtools railway delete-service-domain [selectors...] [--domain <domain>] [--service-domain-id <id>]
  agentic-devtools railway create-custom-domain [selectors...] --domain <domain> [--target-port <port>]
  agentic-devtools railway update-custom-domain [selectors...] [--domain <domain>] [--custom-domain-id <id>] [--target-port <port>]
  agentic-devtools railway delete-custom-domain [selectors...] [--domain <domain>] [--custom-domain-id <id>]
  agentic-devtools railway get-custom-domain [selectors...] [--domain <domain>] [--custom-domain-id <id>]
  agentic-devtools railway wait-custom-domain [selectors...] [--domain <domain>] [--custom-domain-id <id>] [--timeout-ms <ms>] [--poll-interval-ms <ms>]
  agentic-devtools railway create-volume [selectors...] --mount-path <path> [--region <region>] [--input-json <json>]
  agentic-devtools railway delete-volume --volume-id <id>

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

	if (
		!command ||
		command === "--help" ||
		command === "-h" ||
		command === "help"
	) {
		return { __usage: railwayCliUsage() };
	}

	switch (command) {
		case "list-projects":
			return client.listProjects({
				workspaceId: getStringOption(options, "workspace-id"),
				includeDeleted: getBooleanOption(options, "include-deleted") ?? false,
				first: getIntegerOption(options, "first") ?? 100,
			});

		case "create-project":
			return client.createProject(
				mergeInput(
					{
						name: requireStringOption(options, "name", command),
						description: getStringOption(options, "description"),
						workspaceId: getStringOption(options, "workspace-id"),
					},
					getJsonOption(options, "input-json", command),
				),
			);

		case "get-project": {
			const project = await resolveProject(client, options, command);
			return client.getProject(project.projectId);
		}

		case "update-project": {
			const project = await resolveProject(client, options, command);
			return client.updateProject({
				projectId: project.projectId,
				...mergeInput(
					{
						name: getStringOption(options, "name"),
						description: getStringOption(options, "description"),
						baseEnvironmentId: getStringOption(options, "base-environment-id"),
						botPrEnvironments: getBooleanOption(options, "bot-pr-environments"),
						focusedPrEnvironments: getBooleanOption(
							options,
							"focused-pr-environments",
						),
						isPublic: getBooleanOption(options, "is-public"),
						prDeploys: getBooleanOption(options, "pr-deploys"),
					},
					getJsonOption(options, "input-json", command),
				),
			});
		}

		case "delete-project": {
			const project = await resolveProject(client, options, command);
			return client.deleteProject(project.projectId);
		}

		case "transfer-project": {
			const project = await resolveProject(client, options, command);
			return client.transferProject({
				projectId: project.projectId,
				workspaceId: requireStringOption(options, "workspace-id", command),
			});
		}

		case "get-project-members": {
			const project = await resolveProject(client, options, command);
			return client.getProjectMembers(project.projectId);
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

		case "create-environment": {
			const project = await resolveProject(client, options, command);
			const sourceEnvironment =
				hasSelector(options, "source-environment-id") ||
				hasSelector(options, "source-environment-name")
					? await client.resolveEnvironmentSelector({
							projectId: project.projectId,
							environmentId: getStringOption(options, "source-environment-id"),
							environmentName: getStringOption(
								options,
								"source-environment-name",
							),
							operation: command,
						})
					: null;

			return client.createEnvironment(
				mergeInput(
					{
						projectId: project.projectId,
						name: requireStringOption(options, "name", command),
						ephemeral: getBooleanOption(options, "ephemeral"),
						sourceEnvironmentId: sourceEnvironment?.environmentId ?? undefined,
						applyChangesInBackground: getBooleanOption(
							options,
							"apply-changes-in-background",
						),
						skipInitialDeploys: getBooleanOption(
							options,
							"skip-initial-deploys",
						),
						stageInitialChanges: getBooleanOption(
							options,
							"stage-initial-changes",
						),
					},
					getJsonOption(options, "input-json", command),
				),
			);
		}

		case "get-environment": {
			const environment = await resolveEnvironment(client, options, command);
			return client.getEnvironment(environment.environmentId);
		}

		case "delete-environment": {
			const environment = await resolveEnvironment(client, options, command);
			return client.deleteEnvironment(environment.environmentId);
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

		case "create-service": {
			const project = await resolveProject(client, options, command);
			const environment =
				hasSelector(options, "environment-id") ||
				hasSelector(options, "environment-name")
					? await resolveEnvironment(client, options, command)
					: null;

			return client.createService(
				mergeInput(
					{
						projectId: project.projectId,
						environmentId: environment?.environmentId ?? undefined,
						name: getStringOption(options, "name"),
						icon: getStringOption(options, "icon"),
						branch: getStringOption(options, "branch"),
						templateId: getStringOption(options, "template-id"),
						templateServiceId: getStringOption(options, "template-service-id"),
						source: getJsonOption(options, "source-json", command),
						variables: getJsonOption(options, "variables-json", command),
						registryCredentials: getJsonOption(
							options,
							"registry-credentials-json",
							command,
						),
					},
					getJsonOption(options, "input-json", command),
				),
			);
		}

		case "get-service": {
			const service = await resolveService(client, options, command);
			return client.getService(service.serviceId);
		}

		case "delete-service": {
			const service = await resolveService(client, options, command);
			return client.deleteService({
				serviceId: service.serviceId,
				environmentId: getStringOption(options, "environment-id"),
			});
		}

		case "get-service-instance": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.getServiceInstance({
				serviceId: instance.serviceId,
				environmentId: instance.environmentId,
			});
		}

		case "get-service-instance-limits": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.getServiceInstanceLimits({
				serviceId: instance.serviceId,
				environmentId: instance.environmentId,
			});
		}

		case "list-deployments": {
			const selectors = await resolveDeploymentSelectors(
				client,
				options,
				command,
			);
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

		case "get-deployment":
			return client.getDeployment(
				requireStringOption(options, "deployment-id", command),
			);

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
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
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
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.updateServiceInstanceLimits({
				serviceId: instance.serviceId,
				environmentId: instance.environmentId,
				memoryGB: getNumberOption(options, "memory-gb"),
				vCPUs: getNumberOption(options, "v-cpus"),
			});
		}

		case "deploy": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.deployService({
				serviceId: instance.serviceId,
				environmentId: instance.environmentId,
				commitSha: getStringOption(options, "commit-sha"),
				latestCommit: getBooleanOption(options, "latest-commit"),
			});
		}

		case "redeploy": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.redeployService({
				serviceId: instance.serviceId,
				environmentId: instance.environmentId,
			});
		}

		case "set-variable": {
			const environment = await resolveEnvironment(client, options, command);
			const service =
				hasSelector(options, "service-id") ||
				hasSelector(options, "service-name")
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
				hasSelector(options, "service-id") ||
				hasSelector(options, "service-name")
					? await resolveService(client, options, command)
					: null;
			return client.deleteVariable({
				projectId: environment.projectId,
				environmentId: environment.environmentId,
				serviceId: service?.serviceId ?? undefined,
				name: requireStringOption(options, "name", command),
			});
		}

		case "list-variables": {
			const environment = await resolveEnvironment(client, options, command);
			const service =
				hasSelector(options, "service-id") ||
				hasSelector(options, "service-name")
					? await resolveService(client, options, command)
					: null;
			return client.listVariables({
				projectId: environment.projectId,
				environmentId: environment.environmentId,
				serviceId: service?.serviceId ?? undefined,
			});
		}

		case "create-service-domain": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
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

		case "update-service-domain": {
			const domain = await resolveServiceDomain(client, options, command);
			return client.updateServiceDomain({
				serviceDomainId: domain.serviceDomainId,
				serviceId: domain.serviceId,
				environmentId: domain.environmentId,
				domain: getStringOption(options, "domain") ?? domain.domain,
				targetPort: getIntegerOption(options, "target-port") ?? undefined,
			});
		}

		case "delete-service-domain": {
			const domain = await resolveServiceDomain(client, options, command);
			return client.deleteServiceDomain(domain.serviceDomainId);
		}

		case "create-custom-domain": {
			const instance = await resolveServiceAndEnvironment(
				client,
				options,
				command,
			);
			return client.createCustomDomain({
				projectId: instance.projectId,
				environmentId: instance.environmentId,
				serviceId: instance.serviceId,
				domain: requireStringOption(options, "domain", command),
				targetPort: getIntegerOption(options, "target-port"),
			});
		}

		case "update-custom-domain": {
			const domain = await resolveCustomDomain(client, options, command);
			return client.updateCustomDomain({
				customDomainId: domain.customDomainId,
				environmentId: domain.environmentId,
				targetPort: getIntegerOption(options, "target-port"),
			});
		}

		case "delete-custom-domain": {
			const domain = await resolveCustomDomain(client, options, command);
			return client.deleteCustomDomain(domain.customDomainId);
		}

		case "get-custom-domain": {
			const domain = await resolveCustomDomain(client, options, command);
			return client.getCustomDomain(domain.customDomainId);
		}

		case "wait-custom-domain": {
			const domain = await resolveCustomDomain(client, options, command);
			return client.waitForCustomDomain({
				customDomainId: domain.customDomainId,
				timeoutMs: getIntegerOption(options, "timeout-ms") ?? undefined,
				pollIntervalMs:
					getIntegerOption(options, "poll-interval-ms") ?? undefined,
			});
		}

		case "create-volume": {
			const project = await resolveProject(client, options, command);
			const environment =
				hasSelector(options, "environment-id") ||
				hasSelector(options, "environment-name")
					? await resolveEnvironment(client, options, command)
					: null;
			const service =
				hasSelector(options, "service-id") ||
				hasSelector(options, "service-name")
					? await resolveService(client, options, command)
					: null;

			return client.createVolume(
				mergeInput(
					{
						projectId: project.projectId,
						environmentId: environment?.environmentId ?? undefined,
						serviceId: service?.serviceId ?? undefined,
						mountPath: requireStringOption(options, "mount-path", command),
						region: getStringOption(options, "region"),
					},
					getJsonOption(options, "input-json", command),
				),
			);
		}

		case "delete-volume":
			return client.deleteVolume(
				requireStringOption(options, "volume-id", command),
			);

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
	const environment = service.environmentId
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

const resolveServiceDomain = async (client, options, operation) => {
	const serviceDomainId = getStringOption(options, "service-domain-id");
	const explicitDomain = getStringOption(options, "domain");
	const instance = await resolveServiceAndEnvironment(
		client,
		options,
		operation,
	);
	const serviceInstance = await client.getServiceInstance({
		serviceId: instance.serviceId,
		environmentId: instance.environmentId,
	});
	const serviceDomains = serviceInstance.domains?.serviceDomains ?? [];

	if (serviceDomainId) {
		const matched = serviceDomains.find(
			(entry) => entry.id === serviceDomainId,
		);
		return {
			serviceDomainId,
			domain: matched?.domain ?? explicitDomain ?? null,
			serviceId: instance.serviceId,
			environmentId: instance.environmentId,
		};
	}

	if (!explicitDomain) {
		throw new RailwayApiError(
			`${operation} requires --service-domain-id or --domain.`,
		);
	}

	const matched = serviceDomains.find(
		(entry) => entry.domain === explicitDomain,
	);
	if (!matched) {
		throw new RailwayApiError(
			`${operation} could not find a matching Railway service domain for "${explicitDomain}".`,
		);
	}

	return {
		serviceDomainId: matched.id,
		domain: matched.domain,
		serviceId: instance.serviceId,
		environmentId: instance.environmentId,
	};
};

const resolveCustomDomain = async (client, options, operation) => {
	const customDomainId = getStringOption(options, "custom-domain-id");
	const explicitDomain = getStringOption(options, "domain");
	const instance = await resolveServiceAndEnvironment(
		client,
		options,
		operation,
	);
	const serviceInstance = await client.getServiceInstance({
		serviceId: instance.serviceId,
		environmentId: instance.environmentId,
	});
	const customDomains = serviceInstance.domains?.customDomains ?? [];

	if (customDomainId) {
		const matched = customDomains.find((entry) => entry.id === customDomainId);
		return {
			customDomainId,
			domain: matched?.domain ?? explicitDomain ?? null,
			serviceId: instance.serviceId,
			environmentId: instance.environmentId,
		};
	}

	if (!explicitDomain) {
		throw new RailwayApiError(
			`${operation} requires --custom-domain-id or --domain.`,
		);
	}

	const matched = customDomains.find(
		(entry) => entry.domain === explicitDomain,
	);
	if (!matched) {
		throw new RailwayApiError(
			`${operation} could not find a matching Railway custom domain for "${explicitDomain}".`,
		);
	}

	return {
		customDomainId: matched.id,
		domain: matched.domain,
		serviceId: instance.serviceId,
		environmentId: instance.environmentId,
	};
};

const resolveDeploymentSelectors = async (client, options, operation) => {
	let projectId = null;
	let environmentId = null;
	let serviceId = null;

	if (
		hasSelector(options, "project-id") ||
		hasSelector(options, "project-name")
	) {
		const project = await resolveProject(client, options, operation);
		projectId = project.projectId;
	}

	if (
		hasSelector(options, "environment-id") ||
		hasSelector(options, "environment-name")
	) {
		const environment = await resolveEnvironment(client, options, operation);
		projectId = environment.projectId ?? projectId;
		environmentId = environment.environmentId;
	}

	if (
		hasSelector(options, "service-id") ||
		hasSelector(options, "service-name")
	) {
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
		multiRegionConfig: getJsonOption(
			options,
			"multi-region-config-json",
			operation,
		),
		nixpacksPlan: getJsonOption(options, "nixpacks-plan-json", operation),
		numReplicas: getIntegerOption(options, "num-replicas"),
		overlapSeconds: getIntegerOption(options, "overlap-seconds"),
		preDeployCommand: getStringArrayOption(options, "pre-deploy-command"),
		railwayConfigFile: getStringOption(options, "railway-config-file"),
		region: getStringOption(options, "region"),
		registryCredentials: getJsonOption(
			options,
			"registry-credentials-json",
			operation,
		),
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
			assignOption(
				options,
				withoutPrefix.slice(0, eqIndex),
				withoutPrefix.slice(eqIndex + 1),
			);
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

	const normalized = String(
		Array.isArray(value) ? value[value.length - 1] : value,
	)
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
