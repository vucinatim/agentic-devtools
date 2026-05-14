import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_NPM_REGISTRY, getNpmAuthStatus, resolveNpmAuthConfig } from "./auth.mjs";

export class NpmRegistryError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "NpmRegistryError";
    this.details = details;
  }
}

export const encodePackageName = (packageName) =>
  encodeURIComponent(String(packageName ?? "").trim());

const normalizeRegistry = (registry = DEFAULT_NPM_REGISTRY) =>
  String(registry || DEFAULT_NPM_REGISTRY).replace(/\/+$/, "");

const isNotFound = (error) =>
  error instanceof NpmRegistryError && error.details.status === 404;

export const createNpmClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const auth = resolveNpmAuthConfig(env);
  const registry = normalizeRegistry(auth.registry);

  if (typeof fetchImpl !== "function") {
    throw new Error("npm client requires a fetch implementation.");
  }

  const request = async (pathname, { method = "GET", body, authRequired = false, headers = {} } = {}) => {
    if (authRequired && !auth.token) {
      throw new NpmRegistryError(
        "Missing npm token. Run `agentic-devtools connect npm`, set NPM_TOKEN/NODE_AUTH_TOKEN, or configure ~/.npmrc.",
      );
    }

    const response = await fetchImpl(`${registry}${pathname}`, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...(authRequired ? { Authorization: `Bearer ${auth.token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text };
      }
    }

    if (!response.ok) {
      throw new NpmRegistryError(formatNpmErrorMessage(payload, response.status), {
        status: response.status,
        payload,
      });
    }

    return payload;
  };

  const getCurrentUser = async () => request("/-/whoami", { authRequired: true });

  const getPackageInfo = async (packageName) =>
    request(`/${encodePackageName(packageName)}`, { authRequired: false });

  const checkPackageNameAvailability = async (packageName) => {
    try {
      const info = await getPackageInfo(packageName);
      return {
        packageName,
        available: false,
        version: info["dist-tags"]?.latest ?? null,
        description: info.description ?? null,
      };
    } catch (error) {
      if (isNotFound(error)) {
        return {
          packageName,
          available: true,
          version: null,
          description: null,
        };
      }
      throw error;
    }
  };

  const getPackageVersions = async (packageName) => {
    const info = await getPackageInfo(packageName);
    return {
      packageName: info.name,
      latest: info["dist-tags"]?.latest ?? null,
      versions: Object.keys(info.versions ?? {}),
    };
  };

  const getPackageDistTags = async (packageName) => {
    const info = await getPackageInfo(packageName);
    return {
      packageName: info.name,
      distTags: info["dist-tags"] ?? {},
    };
  };

  const getPackageVisibility = async (packageName) =>
    request(`/-/package/${encodePackageName(packageName)}/visibility`, {
      authRequired: true,
    });

  const setPackageAccess = async ({
    packageName,
    access = "public",
    publishRequiresTfa,
    automationTokenOverridesTfa,
  }) =>
    request(`/-/package/${encodePackageName(packageName)}/access`, {
      method: "POST",
      authRequired: true,
      body: {
        access,
        ...(publishRequiresTfa == null
          ? {}
          : { publish_requires_tfa: Boolean(publishRequiresTfa) }),
        ...(automationTokenOverridesTfa == null
          ? {}
          : { automation_token_overrides_tfa: Boolean(automationTokenOverridesTfa) }),
      },
    });

  const listTokens = async ({ page = 0, perPage = 10 } = {}) =>
    request(`/-/npm/v1/tokens?page=${page}&perPage=${perPage}`, {
      authRequired: true,
    });

  const deleteToken = async ({ token, otp } = {}) =>
    request(`/-/npm/v1/tokens/token/${encodeURIComponent(token)}`, {
      method: "DELETE",
      authRequired: true,
      headers: otp ? { "npm-otp": otp } : {},
    });

  const getTrustedPublishers = async ({ packageName, otp } = {}) =>
    request(`/-/package/${encodePackageName(packageName)}/trust`, {
      authRequired: true,
      headers: otp ? { "npm-otp": otp } : {},
    });

  const addGitHubTrustedPublisher = async ({
    packageName,
    repository,
    workflowFile = "publish.yml",
    environment,
    otp,
  } = {}) =>
    request(`/-/package/${encodePackageName(packageName)}/trust`, {
      method: "POST",
      authRequired: true,
      headers: otp ? { "npm-otp": otp } : {},
      body: [
        {
          type: "github",
          claims: {
            repository,
            workflow_ref: {
              file: workflowFile,
            },
            ...(environment ? { environment } : {}),
          },
        },
      ],
    });

  const deleteTrustedPublisher = async ({ packageName, configId, otp } = {}) =>
    request(
      `/-/package/${encodePackageName(packageName)}/trust/${encodeURIComponent(configId)}`,
      {
        method: "DELETE",
        authRequired: true,
        headers: otp ? { "npm-otp": otp } : {},
      },
    );

  const exchangeOidcToken = async ({ packageName, oidcToken } = {}) => {
    if (!oidcToken) {
      throw new NpmRegistryError("Missing OIDC id_token for npm token exchange.");
    }
    return request(`/-/npm/v1/oidc/token/exchange/package/${encodePackageName(packageName)}`, {
      method: "POST",
      authRequired: false,
      headers: { Authorization: `Bearer ${oidcToken}` },
    });
  };

  const publishPackageDirectory = async ({
    cwd = process.cwd(),
    tag = "latest",
    access = "public",
    dryRun = true,
    confirm = "",
  } = {}) => {
    const packageJson = JSON.parse(
      await readFile(path.join(cwd, "package.json"), "utf8"),
    );
    if (!dryRun && confirm !== `publish ${packageJson.name}@${packageJson.version}`) {
      throw new NpmRegistryError(
        `Publishing requires confirm="publish ${packageJson.name}@${packageJson.version}".`,
      );
    }

    const args = ["publish", "--access", access, "--tag", tag];
    if (dryRun) {
      args.push("--dry-run");
    }

    const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-npm-"));
    const userconfigPath = path.join(tempDir, ".npmrc");
    if (auth.token) {
      const registryUrl = new URL(registry);
      await writeFile(
        userconfigPath,
        `registry=${registry}/\n//${registryUrl.host}/:_authToken=${auth.token}\n`,
      );
      await chmod(userconfigPath, 0o600).catch(() => {});
    }

    const envForPublish = {
      ...process.env,
      ...env,
      NPM_CONFIG_REGISTRY: registry,
      ...(auth.token ? { NPM_CONFIG_USERCONFIG: userconfigPath } : {}),
    };

    try {
      const result = await execNpm(args, { cwd, env: envForPublish });
      return {
        ok: result.status === 0,
        dryRun,
        packageName: packageJson.name,
        version: packageJson.version,
        tag,
        access,
        tokenSource: auth.source,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  };

  return {
    auth,
    registry,
    getAuthStatus: () => getNpmAuthStatus(env),
    getCurrentUser,
    getPackageInfo,
    checkPackageNameAvailability,
    getPackageVersions,
    getPackageDistTags,
    getPackageVisibility,
    setPackageAccess,
    listTokens,
    deleteToken,
    getTrustedPublishers,
    addGitHubTrustedPublisher,
    deleteTrustedPublisher,
    exchangeOidcToken,
    publishPackageDirectory,
  };
};

const execNpm = (args, { cwd, env }) =>
  new Promise((resolve, reject) => {
    execFile("npm", args, { cwd, env }, (error, stdout, stderr) => {
      const result = {
        status: error?.code ?? 0,
        stdout,
        stderr,
      };
      if (error && error.code == null) {
        reject(error);
        return;
      }
      resolve(result);
    });
  });

const formatNpmErrorMessage = (payload, status) => {
  if (payload && typeof payload === "object") {
    const message = payload.error || payload.message;
    if (typeof message === "string" && message.trim()) {
      const trimmed = message.trim();
      try {
        const nested = JSON.parse(trimmed);
        if (typeof nested?.error === "string" && nested.error.trim()) {
          return nested.error.trim();
        }
      } catch {
        // Keep the original npm error string when it is not nested JSON.
      }
      return trimmed;
    }
  }
  return `npm registry request failed with HTTP ${status}`;
};
