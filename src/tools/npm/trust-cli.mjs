import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_NPM_REGISTRY, resolveNpmAuthConfig } from "./auth.mjs";

export const DEFAULT_NPM_TRUST_CLI_SPEC = "npm@^11.10.0";

const normalizeRegistry = (registry = DEFAULT_NPM_REGISTRY) =>
  String(registry || DEFAULT_NPM_REGISTRY).replace(/\/+$/, "");

export const buildNpmTrustGithubArgs = ({
  packageName = "@vucinatim/agentic-devtools",
  repository = "vucinatim/agentic-devtools",
  workflowFile = "publish.yml",
  environment = "",
  yes = true,
} = {}) => {
  const args = [
    DEFAULT_NPM_TRUST_CLI_SPEC,
    "trust",
    "github",
    String(packageName).trim(),
    "--repo",
    String(repository).trim(),
    "--file",
    String(workflowFile).trim(),
  ];

  if (environment) {
    args.push("--env", String(environment).trim());
  }
  if (yes) {
    args.push("--yes");
  }

  return args;
};

export const buildNpmWebLoginArgs = () => [
  DEFAULT_NPM_TRUST_CLI_SPEC,
  "login",
  "--auth-type=web",
  "--registry",
  DEFAULT_NPM_REGISTRY,
];

export const runNpmTrustGithubSetup = async ({
  env = process.env,
  stdio = "pipe",
  loginFirst = false,
  ...options
} = {}) => {
  const auth = resolveNpmAuthConfig(env);
  const registry = normalizeRegistry(auth.registry);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "agentic-npm-trust-"));
  const userconfigPath = path.join(tempDir, ".npmrc");

  if (auth.token && !loginFirst) {
    const registryUrl = new URL(registry);
    await writeFile(
      userconfigPath,
      `registry=${registry}/\n//${registryUrl.host}/:_authToken=${auth.token}\n`,
    );
    await chmod(userconfigPath, 0o600).catch(() => {});
  }

  const commandEnv = {
    ...process.env,
    ...env,
    NPM_CONFIG_REGISTRY: registry,
    ...(auth.token && !loginFirst ? { NPM_CONFIG_USERCONFIG: userconfigPath } : {}),
  };

  try {
    if (loginFirst) {
      const loginArgs = ["-y", ...buildNpmWebLoginArgs()];
      const loginResult = await spawnCommand("npx", loginArgs, {
        env: commandEnv,
        stdio,
      });
      if (loginResult.status !== 0) {
        return {
          ok: false,
          status: loginResult.status,
          command: "npx",
          args: loginArgs,
          step: "login",
          tokenSource: auth.source,
          stdout: loginResult.stdout,
          stderr: loginResult.stderr,
        };
      }
    }

    const args = ["-y", ...buildNpmTrustGithubArgs(options)];
    const result = await spawnCommand("npx", args, {
      env: commandEnv,
      stdio,
    });

    return {
      ok: result.status === 0,
      status: result.status,
      command: "npx",
      args,
      step: "trust",
      tokenSource: auth.source,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const spawnCommand = (command, args, { env, stdio }) =>
  new Promise((resolve, reject) => {
    const shouldCapture = stdio === "pipe";
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, {
      env,
      stdio,
    });

    if (shouldCapture) {
      child.stdout?.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr?.on("data", (chunk) => {
        stderr += chunk;
      });
    }

    child.on("error", reject);
    child.on("close", (status) => {
      resolve({
        status: status ?? 1,
        stdout,
        stderr,
      });
    });
  });
