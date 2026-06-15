import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import {
  escapeHtml,
  openBrowser,
  parseFormBody,
  pickString,
  readJsonConfigSync,
  removeJsonConfig,
  resolveConfigPath,
  writeJsonConfig,
} from "../../core/config-store.mjs";

export const DEFAULT_RAILWAY_API_ENDPOINT =
  "https://backboard.railway.com/graphql/v2";

// Working token path. By default global, but the per-project .mcp.json sets
// RAILWAY_AUTH_CONFIG_PATH=.zeroframe/credentials/railway.json so the MCP
// picks up the project-scoped working token.
export const RAILWAY_AUTH_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "RAILWAY_AUTH_CONFIG_PATH",
  fileName: "railway.json",
});

// Bootstrap path — always global. Holds an account-level Railway token used
// only to mint project-scoped working tokens. Override via env only for tests.
export const RAILWAY_BOOTSTRAP_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "RAILWAY_BOOTSTRAP_CONFIG_PATH",
  fileName: "railway-bootstrap.json",
});

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const shouldReadStoredConfig = (env) =>
  env === process.env || typeof env.RAILWAY_AUTH_CONFIG_PATH === "string";

const readStoredRailwayAuthConfig = (env = process.env) => {
  if (!shouldReadStoredConfig(env)) {
    return null;
  }

  const configPath = resolveConfigPath({
    env,
    envVar: "RAILWAY_AUTH_CONFIG_PATH",
    fileName: "railway.json",
  });

  return readJsonConfigSync(configPath);
};

export const saveRailwayAuthConfig = async ({
  token,
  kind = "account",
  defaultProjectId = "",
  endpoint = "",
} = {}) => {
  const normalizedKind = String(kind ?? "").trim();
  if (!["account", "project"].includes(normalizedKind)) {
    throw new Error("Railway token kind must be account or project.");
  }

  const config = {
    token: String(token ?? "").trim(),
    kind: normalizedKind,
    defaultProjectId: String(defaultProjectId ?? "").trim(),
    endpoint: String(endpoint ?? "").trim(),
    savedAt: new Date().toISOString(),
  };

  if (!config.token) {
    throw new Error("Missing token in Railway auth config.");
  }

  await writeJsonConfig(RAILWAY_AUTH_CONFIG_PATH, config);

  return {
    configPath: RAILWAY_AUTH_CONFIG_PATH,
    kind: config.kind,
    defaultProjectId: config.defaultProjectId || null,
    endpoint: config.endpoint || DEFAULT_RAILWAY_API_ENDPOINT,
  };
};

export const resolveRailwayApiToken = (env = process.env) => {
  const projectToken = pickString(env.RAILWAY_PROJECT_TOKEN);
  if (projectToken) {
    return {
      token: projectToken,
      kind: "project",
      source: "env:RAILWAY_PROJECT_TOKEN",
    };
  }

  const apiToken = pickString(env.RAILWAY_API_TOKEN);
  if (apiToken) {
    return {
      token: apiToken,
      kind: "account",
      source: "env:RAILWAY_API_TOKEN",
    };
  }

  const token = pickString(env.RAILWAY_TOKEN);
  if (token) {
    return {
      token,
      kind: "account",
      source: "env:RAILWAY_TOKEN",
    };
  }

  const stored = readStoredRailwayAuthConfig(env);
  if (stored?.token) {
    return {
      token: stored.token,
      kind: stored.kind === "project" ? "project" : "account",
      source: "file",
    };
  }

  return {
    token: null,
    kind: null,
    source: null,
  };
};

export const getRailwayAuthStatus = (env = process.env) => {
  const stored = readStoredRailwayAuthConfig(env);
  const auth = resolveRailwayApiToken(env);
  return {
    configured: Boolean(auth.token),
    kind: auth.kind,
    source: auth.source,
    endpoint:
      pickString(env.RAILWAY_API_ENDPOINT) ||
      pickString(stored?.endpoint) ||
      DEFAULT_RAILWAY_API_ENDPOINT,
    defaultProjectId:
      pickString(env.RAILWAY_PROJECT_ID) ||
      pickString(stored?.defaultProjectId) ||
      null,
    configPath: resolveConfigPath({
      env,
      envVar: "RAILWAY_AUTH_CONFIG_PATH",
      fileName: "railway.json",
    }),
  };
};

export const clearStoredRailwayAuthConfig = async () => {
  await removeJsonConfig(RAILWAY_AUTH_CONFIG_PATH);
};

// -- Bootstrap (global, rarely used) ----------------------------------------

const readStoredRailwayBootstrap = (env = process.env) => {
  const configPath = resolveConfigPath({
    env,
    envVar: "RAILWAY_BOOTSTRAP_CONFIG_PATH",
    fileName: "railway-bootstrap.json",
  });
  return readJsonConfigSync(configPath);
};

export const saveRailwayBootstrapToken = async ({ token } = {}) => {
  const config = {
    type: "bootstrap",
    token: String(token ?? "").trim(),
    kind: "account",
    savedAt: new Date().toISOString(),
  };
  if (!config.token) {
    throw new Error("Missing token for Railway bootstrap.");
  }
  await writeJsonConfig(RAILWAY_BOOTSTRAP_CONFIG_PATH, config);
  return { configPath: RAILWAY_BOOTSTRAP_CONFIG_PATH };
};

export const getRailwayBootstrapToken = (env = process.env) => {
  const envToken = pickString(env.RAILWAY_BOOTSTRAP_TOKEN);
  if (envToken) {
    return { token: envToken, source: "env:RAILWAY_BOOTSTRAP_TOKEN" };
  }
  const stored = readStoredRailwayBootstrap(env);
  if (stored?.token) {
    return { token: stored.token, source: "file:bootstrap" };
  }
  return { token: null, source: null };
};

export const getRailwayBootstrapStatus = (env = process.env) => {
  const b = getRailwayBootstrapToken(env);
  return {
    configured: Boolean(b.token),
    source: b.source,
    configPath: RAILWAY_BOOTSTRAP_CONFIG_PATH,
  };
};

export const clearStoredRailwayBootstrap = async () => {
  await removeJsonConfig(RAILWAY_BOOTSTRAP_CONFIG_PATH);
};

export const disconnectRailway = async () => {
  await clearStoredRailwayAuthConfig();
  return {
    disconnected: true,
    configPath: RAILWAY_AUTH_CONFIG_PATH,
  };
};

/* v8 ignore start */
const renderRailwayPage = ({ csrfToken, message = "", defaults = {} }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Railway Setup</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #17181c;
        --muted: #5d6472;
        --accent: #6d5dfc;
        --border: #dde1ea;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .wrap {
        max-width: 760px;
        margin: 32px auto;
        padding: 24px;
      }
      .panel {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 16px;
        padding: 24px;
      }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: var(--muted); }
      a { color: var(--accent); }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input, select {
        padding: 12px 14px;
        border-radius: 10px;
        border: 1px solid var(--border);
        font: inherit;
        background: white;
      }
      .row { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }
      .message {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 10px;
        background: #fff1ec;
        color: #8f2719;
      }
      button {
        border: 0;
        border-radius: 999px;
        padding: 12px 18px;
        font: inherit;
        font-weight: 700;
        color: white;
        background: var(--accent);
        cursor: pointer;
        width: fit-content;
      }
      code {
        background: #eceef5;
        padding: 2px 6px;
        border-radius: 6px;
      }
      @media (max-width: 720px) {
        .row { grid-template-columns: 1fr; }
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Connect Railway</h1>
        <p>Paste a Railway token. Project tokens are lowest risk for project inspection. Account tokens enable account identity and project listing.</p>
        <ol>
          <li>Open <a href="https://railway.com/account/tokens" target="_blank" rel="noreferrer">Railway account tokens</a> for an account token.</li>
          <li>For a narrower token, create a project token in the Railway project settings.</li>
          <li>Save it here, then run <code>agentic-devtools test-connection railway</code>.</li>
        </ol>
        ${
          message
            ? `<div class="message">${escapeHtml(message)}</div>`
            : ""
        }
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Token
            <input name="token" type="password" value="" required />
          </label>
          <div class="row">
            <label>
              Token Scope
              <select name="kind">
                <option value="project" ${defaults.kind === "project" ? "selected" : ""}>Project token</option>
                <option value="account" ${defaults.kind !== "project" ? "selected" : ""}>Account token</option>
              </select>
            </label>
            <label>
              Default Project ID (optional)
              <input name="defaultProjectId" type="text" value="${escapeHtml(defaults.defaultProjectId ?? "")}" />
            </label>
          </div>
          <label>
            API Endpoint Override (optional)
            <input name="endpoint" type="text" value="${escapeHtml(defaults.endpoint ?? "")}" placeholder="${DEFAULT_RAILWAY_API_ENDPOINT}" />
          </label>
          <button type="submit">Save Railway Token</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

export const runRailwayBrowserAuthFlow = async ({
  validateConnection = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const status = getRailwayAuthStatus();
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
          renderRailwayPage({
            csrfToken,
            defaults: {
              kind: status.kind ?? "project",
              defaultProjectId: status.defaultProjectId ?? "",
              endpoint:
                status.endpoint === DEFAULT_RAILWAY_API_ENDPOINT
                  ? ""
                  : status.endpoint,
            },
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/save") {
        let body = {};
        try {
          body = await parseFormBody(request);
          if (body.csrfToken !== csrfToken) {
            response.writeHead(403, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end("Invalid CSRF token.");
            return;
          }

          if (validateConnection) {
            const { createRailwayClient } = await import("./client.mjs");
            const client = createRailwayClient({
              env: {
                RAILWAY_PROJECT_TOKEN:
                  body.kind === "project" ? String(body.token ?? "") : "",
                RAILWAY_API_TOKEN:
                  body.kind === "account" ? String(body.token ?? "") : "",
                RAILWAY_PROJECT_ID: String(body.defaultProjectId ?? ""),
                RAILWAY_API_ENDPOINT: String(body.endpoint ?? ""),
              },
            });
            if (client.auth.kind === "project") {
              await client.getProjectTokenContext();
            } else {
              await client.validateAccountToken();
            }
          }

          const saved = await saveRailwayAuthConfig({
            token: body.token,
            kind: body.kind,
            defaultProjectId: body.defaultProjectId,
            endpoint: body.endpoint,
          });

          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>Railway connected</h1><p>Token was saved to <code>${escapeHtml(saved.configPath)}</code>. You can close this tab.</p></body></html>`);
          finish(() => resolve(saved));
        } catch (error) {
          response.writeHead(400, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            renderRailwayPage({
              csrfToken,
              message: error instanceof Error ? error.message : String(error),
              defaults: {
                kind: body.kind,
                defaultProjectId: body.defaultProjectId,
                endpoint: body.endpoint,
              },
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
          throw new Error("Failed to bind local Railway auth server.");
        }

        const url = `http://127.0.0.1:${address.port}/`;
        await openBrowser(url, { skipEnvVar: "RAILWAY_SKIP_BROWSER_OPEN" });
      } catch (error) {
        finish(() => reject(error));
      }
    });

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(new Error("Timed out waiting for Railway browser setup to complete.")),
      );
    }, timeoutMs);
  });
};
/* v8 ignore stop */

export const connectRailway = runRailwayBrowserAuthFlow;

/* v8 ignore start */
/**
 * Browser-based bootstrap flow for Railway. Identical mechanics to the
 * existing setup flow, but copy is tailored to the bootstrap concept and the
 * saved file lives at the bootstrap path (not the working path).
 *
 * Used by `agentic-devtools bootstrap railway`. Saves an account-level token
 * for one-per-machine use.
 */
export const runRailwayBootstrapFlow = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const csrfToken = randomUUID();

  const renderBootstrapPage = ({ message = "" }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Railway Bootstrap</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #17181c; }
      .wrap { max-width: 760px; margin: 32px auto; padding: 24px; }
      .panel { background: #fff; border: 1px solid #dde1ea; border-radius: 16px; padding: 24px; }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: #5d6472; }
      a { color: #6d5dfc; }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input { padding: 12px 14px; border-radius: 10px; border: 1px solid #dde1ea; font: inherit; background: white; }
      .message { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #fff1ec; color: #8f2719; }
      .callout { background: #f0f7ff; border-left: 4px solid #0b6dc7; padding: 12px 16px; border-radius: 6px; margin: 16px 0; color: #17181c; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; font: inherit; font-weight: 700; color: white; background: #6d5dfc; cursor: pointer; width: fit-content; }
      code { background: #eef0f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Bootstrap Railway</h1>
        <p>You'll do this once per machine. After bootstrap, every zeroframe project gets its own project-scoped Railway token automatically (created when you provision Railway infra for that project).</p>

        <div class="callout">
          <strong>Use an account-level token, not a project token.</strong> The bootstrap is what mints downstream project tokens; it needs the broader account scope.
        </div>

        <ol>
          <li>Open <a href="https://railway.com/account/tokens" target="_blank" rel="noreferrer">railway.com/account/tokens</a>.</li>
          <li>Click <strong>Create New Token</strong>. Name it something like <code>zero-frame-bootstrap</code>.</li>
          <li>Copy the token (shown once) and paste it below.</li>
        </ol>

        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Railway account token
            <input name="token" type="password" required />
          </label>
          <button type="submit">Save Bootstrap</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

  return await new Promise((resolve, reject) => {
    let closed = false;
    let timeoutId;
    const finish = (cb) => {
      if (closed) return;
      closed = true;
      clearTimeout(timeoutId);
      server.close(() => cb());
    };

    const server = createServer(async (request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end(renderBootstrapPage({}));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/save") {
        let body = {};
        try {
          body = await parseFormBody(request);
          if (body.csrfToken !== csrfToken) {
            response.writeHead(403, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end(
              renderBootstrapPage({
                message: "Invalid CSRF token. Reload the page and try again.",
              }),
            );
            return;
          }

          const token = String(body.token ?? "").trim();
          if (!token) throw new Error("Bootstrap token is required.");

          // Probe the token by hitting the viewer query.
          const probeResponse = await fetch(DEFAULT_RAILWAY_API_ENDPOINT, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              query: "query { me { name email } }",
            }),
          });
          const probePayload = await probeResponse.json().catch(() => ({}));
          if (!probeResponse.ok || probePayload?.errors) {
            const msg = (probePayload?.errors ?? [])
              .map((e) => e?.message)
              .filter(Boolean)
              .join(" | ");
            throw new Error(
              `Token rejected by Railway: ${msg || probeResponse.statusText}`,
            );
          }

          await saveRailwayBootstrapToken({ token });

          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Bootstrap saved</title></head>
<body style="font-family:ui-sans-serif,sans-serif;padding:32px;background:#f6f7f9;color:#17181c;">
<h1>Bootstrap saved</h1>
<p>Stored at <code>${escapeHtml(RAILWAY_BOOTSTRAP_CONFIG_PATH)}</code>.</p>
<p>You can close this window. zeroframe will use this token to mint
project-scoped tokens for each project's Railway infrastructure.</p>
</body></html>`);

          finish(() =>
            resolve({
              ok: true,
              configPath: RAILWAY_BOOTSTRAP_CONFIG_PATH,
              user: probePayload?.data?.me ?? null,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unknown Railway bootstrap error.";
          response.writeHead(400, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(renderBootstrapPage({ message }));
        }
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(new Error("Timed out waiting for Railway bootstrap.")),
      );
    }, timeoutMs);

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(() =>
          reject(new Error("Could not determine Railway bootstrap server address.")),
        );
        return;
      }
      const url = `http://127.0.0.1:${address.port}/`;
      try {
        await openBrowser(url);
      } catch (error) {
        finish(() => reject(error));
      }
    });
  });
};
/* v8 ignore stop */
