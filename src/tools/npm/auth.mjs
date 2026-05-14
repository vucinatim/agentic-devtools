import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  escapeHtml,
  openBrowser,
  parseFormBody,
  pickString,
  readJsonConfig,
  readJsonConfigSync,
  removeJsonConfig,
  resolveConfigPath,
  writeJsonConfig,
} from "../../core/config-store.mjs";

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org";
export const NPM_AUTH_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "AGENTIC_DEVTOOLS_NPM_AUTH_CONFIG_PATH",
  fileName: "npm.json",
});

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const normalizeRegistry = (registry = DEFAULT_NPM_REGISTRY) =>
  String(registry || DEFAULT_NPM_REGISTRY).replace(/\/+$/, "");

const npmrcPaths = (env = process.env) => [
  pickString(env.NPM_CONFIG_USERCONFIG),
  path.join(os.homedir(), ".npmrc"),
].filter(Boolean);

const npmrcTokenKeyForRegistry = (registry) => {
  const url = new URL(normalizeRegistry(registry));
  return `//${url.host}${url.pathname === "/" ? "" : url.pathname}/:_authToken`;
};

const parseNpmrc = (content, registry) => {
  const expectedKey = npmrcTokenKeyForRegistry(registry);
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key === expectedKey && value) {
      return value.replace(/^["']|["']$/g, "");
    }
  }

  return null;
};

const readNpmrcToken = async (env = process.env, registry = DEFAULT_NPM_REGISTRY) => {
  if (env !== process.env && !env.NPM_CONFIG_USERCONFIG) {
    return null;
  }

  for (const filePath of npmrcPaths(env)) {
    try {
      const token = parseNpmrc(await readFile(filePath, "utf8"), registry);
      if (token) {
        return { token, source: `npmrc:${filePath}` };
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
};

const readNpmrcTokenSync = (env = process.env, registry = DEFAULT_NPM_REGISTRY) => {
  if (env !== process.env && !env.NPM_CONFIG_USERCONFIG) {
    return null;
  }

  for (const filePath of npmrcPaths(env)) {
    try {
      const token = parseNpmrc(readFileSync(filePath, "utf8"), registry);
      if (token) {
        return { token, source: `npmrc:${filePath}` };
      }
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return null;
};

const shouldReadStoredConfig = (env) =>
  env === process.env ||
  typeof env.AGENTIC_DEVTOOLS_NPM_AUTH_CONFIG_PATH === "string";

const configPathForEnv = (env = process.env) =>
  resolveConfigPath({
    env,
    envVar: "AGENTIC_DEVTOOLS_NPM_AUTH_CONFIG_PATH",
    fileName: "npm.json",
  });

const readStoredNpmAuthConfig = (env = process.env) => {
  if (!shouldReadStoredConfig(env)) {
    return null;
  }
  return readJsonConfigSync(configPathForEnv(env));
};

export const saveNpmAuthConfig = async ({
  token,
  registry = DEFAULT_NPM_REGISTRY,
} = {}) => {
  const config = {
    token: String(token ?? "").trim(),
    registry: normalizeRegistry(registry),
    savedAt: new Date().toISOString(),
  };

  if (!config.token) {
    throw new Error("Missing token in npm auth config.");
  }

  await writeJsonConfig(NPM_AUTH_CONFIG_PATH, config);

  return {
    configPath: NPM_AUTH_CONFIG_PATH,
    registry: config.registry,
  };
};

export const resolveNpmAuthConfig = (env = process.env) => {
  const registry =
    pickString(env.NPM_CONFIG_REGISTRY) ||
    pickString(env.npm_config_registry) ||
    DEFAULT_NPM_REGISTRY;

  const envToken = pickString(env.NPM_TOKEN) || pickString(env.NODE_AUTH_TOKEN);
  if (envToken) {
    return {
      token: envToken,
      registry: normalizeRegistry(registry),
      source: pickString(env.NPM_TOKEN) ? "env:NPM_TOKEN" : "env:NODE_AUTH_TOKEN",
    };
  }

  const stored = readStoredNpmAuthConfig(env);
  if (stored?.token) {
    return {
      token: stored.token,
      registry: normalizeRegistry(stored.registry || registry),
      source: "file",
    };
  }

  const npmrc = readNpmrcTokenSync(env, registry);
  if (npmrc?.token) {
    return {
      token: npmrc.token,
      registry: normalizeRegistry(registry),
      source: npmrc.source,
    };
  }

  return {
    token: null,
    registry: normalizeRegistry(registry),
    source: null,
  };
};

export const getNpmAuthStatus = (env = process.env) => {
  const auth = resolveNpmAuthConfig(env);
  return {
    configured: Boolean(auth.token),
    source: auth.source,
    registry: auth.registry,
    configPath: configPathForEnv(env),
  };
};

export const clearStoredNpmAuthConfig = async () => {
  await removeJsonConfig(NPM_AUTH_CONFIG_PATH);
};

export const disconnectNpm = async () => {
  await clearStoredNpmAuthConfig();
  return {
    disconnected: true,
    configPath: NPM_AUTH_CONFIG_PATH,
  };
};

/* v8 ignore start */
const renderNpmPage = ({ csrfToken, message = "", defaults = {} }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>npm Setup</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f7f8; color: #191919; }
      .wrap { max-width: 760px; margin: 32px auto; padding: 24px; }
      .panel { background: white; border: 1px solid #dedee3; border-radius: 16px; padding: 24px; }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: #5f6068; }
      a { color: #cb3837; }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input { padding: 12px 14px; border-radius: 10px; border: 1px solid #dedee3; font: inherit; background: white; }
      .message { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #fff1ec; color: #8f2719; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; font: inherit; font-weight: 700; color: white; background: #cb3837; cursor: pointer; width: fit-content; }
      code { background: #eeeeef; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Connect npm</h1>
        <p>npm does not provide a normal third-party OAuth login for local tools. Create a granular token, paste it here, and Agentic Devtools will store it locally.</p>
        <ol>
          <li>Open <a href="https://www.npmjs.com/settings/-/tokens" target="_blank" rel="noreferrer">npm access tokens</a>.</li>
          <li>Create the narrowest granular token that matches your task.</li>
          <li>For publishing, prefer GitHub Actions Trusted Publishing instead of long-lived write tokens.</li>
        </ol>
        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            npm Token
            <input name="token" type="password" required />
          </label>
          <label>
            Registry
            <input name="registry" type="text" value="${escapeHtml(defaults.registry ?? DEFAULT_NPM_REGISTRY)}" />
          </label>
          <button type="submit">Save npm Token</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

export const runNpmBrowserAuthFlow = async ({
  validateConnection = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const existing = await readJsonConfig(NPM_AUTH_CONFIG_PATH);
  const csrfToken = randomUUID();

  return await new Promise((resolve, reject) => {
    let closed = false;
    let timeoutId;

    const finish = (callback) => {
      if (closed) {
        return;
      }
      closed = true;
      clearTimeout(timeoutId);
      server.close(() => callback());
    };

    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(
          renderNpmPage({
            csrfToken,
            defaults: { registry: existing?.registry ?? DEFAULT_NPM_REGISTRY },
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/save") {
        let body = {};
        try {
          body = await parseFormBody(request);
          if (body.csrfToken !== csrfToken) {
            response.writeHead(403, { "content-type": "text/html; charset=utf-8" });
            response.end("Invalid CSRF token.");
            return;
          }

          if (validateConnection) {
            const { createNpmClient } = await import("./client.mjs");
            const client = createNpmClient({
              env: {
                NPM_TOKEN: String(body.token ?? ""),
                NPM_CONFIG_REGISTRY: String(body.registry ?? DEFAULT_NPM_REGISTRY),
              },
            });
            await client.getCurrentUser();
          }

          const saved = await saveNpmAuthConfig({
            token: body.token,
            registry: body.registry,
          });

          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>npm connected</h1><p>Token was saved to <code>${escapeHtml(saved.configPath)}</code>. You can close this tab.</p></body></html>`);
          finish(() => resolve(saved));
        } catch (error) {
          response.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          response.end(
            renderNpmPage({
              csrfToken,
              message: error instanceof Error ? error.message : String(error),
              defaults: { registry: body.registry ?? DEFAULT_NPM_REGISTRY },
            }),
          );
        }
        return;
      }

      response.writeHead(404);
      response.end("Not found");
    });

    server.listen(0, "127.0.0.1", async () => {
      try {
        const address = server.address();
        if (!address || typeof address === "string") {
          throw new Error("Failed to bind local npm auth server.");
        }

        await openBrowser(`http://127.0.0.1:${address.port}/`, {
          skipEnvVar: "NPM_SKIP_BROWSER_OPEN",
        });
      } catch (error) {
        finish(() => reject(error));
      }
    });

    timeoutId = setTimeout(() => {
      finish(() => reject(new Error("Timed out waiting for npm browser setup to complete.")));
    }, timeoutMs);
  });
};
/* v8 ignore stop */

export const connectNpm = runNpmBrowserAuthFlow;
