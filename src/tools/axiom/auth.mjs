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

export const DEFAULT_AXIOM_API_BASE_URL = "https://api.axiom.co";

export const AXIOM_AUTH_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "AXIOM_AUTH_CONFIG_PATH",
  fileName: "axiom.json",
});

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const shouldReadStoredConfig = (env) =>
  env === process.env || typeof env.AXIOM_AUTH_CONFIG_PATH === "string";

const readStoredAxiomAuthConfig = (env = process.env) => {
  if (!shouldReadStoredConfig(env)) {
    return null;
  }
  const configPath = resolveConfigPath({
    env,
    envVar: "AXIOM_AUTH_CONFIG_PATH",
    fileName: "axiom.json",
  });
  return readJsonConfigSync(configPath);
};

export const saveAxiomAuthConfig = async ({
  token,
  defaultDataset = "",
  apiBaseUrl = "",
} = {}) => {
  const config = {
    token: String(token ?? "").trim(),
    defaultDataset: String(defaultDataset ?? "").trim(),
    apiBaseUrl: String(apiBaseUrl ?? "").trim(),
    savedAt: new Date().toISOString(),
  };
  if (!config.token) {
    throw new Error("Missing token in Axiom auth config.");
  }
  await writeJsonConfig(AXIOM_AUTH_CONFIG_PATH, config);
  return {
    configPath: AXIOM_AUTH_CONFIG_PATH,
    defaultDataset: config.defaultDataset || null,
    apiBaseUrl: config.apiBaseUrl || DEFAULT_AXIOM_API_BASE_URL,
  };
};

/**
 * Auth resolution order:
 *   1. AXIOM_TOKEN env var
 *   2. Stored ~/.config/agentic-devtools/axiom.json
 *   3. None (token null)
 *
 * `AXIOM_DATASET` env var or stored defaultDataset gives the default dataset
 * when the caller doesn't supply one.
 */
export const resolveAxiomAuthConfig = (env = process.env) => {
  const envToken = pickString(env.AXIOM_TOKEN);
  if (envToken) {
    return {
      token: envToken,
      defaultDataset: pickString(env.AXIOM_DATASET) ?? null,
      apiBaseUrl:
        pickString(env.AXIOM_API_BASE_URL) ?? DEFAULT_AXIOM_API_BASE_URL,
      source: "env:AXIOM_TOKEN",
    };
  }

  const stored = readStoredAxiomAuthConfig(env);
  if (stored?.token) {
    return {
      token: stored.token,
      defaultDataset:
        pickString(env.AXIOM_DATASET, stored.defaultDataset) ?? null,
      apiBaseUrl:
        pickString(env.AXIOM_API_BASE_URL, stored.apiBaseUrl) ??
        DEFAULT_AXIOM_API_BASE_URL,
      source: "file",
    };
  }

  return {
    token: null,
    defaultDataset: pickString(env.AXIOM_DATASET) ?? null,
    apiBaseUrl:
      pickString(env.AXIOM_API_BASE_URL) ?? DEFAULT_AXIOM_API_BASE_URL,
    source: null,
  };
};

export const getAxiomAuthStatus = (env = process.env) => {
  const auth = resolveAxiomAuthConfig(env);
  return {
    configured: Boolean(auth.token),
    source: auth.source,
    defaultDataset: auth.defaultDataset,
    apiBaseUrl: auth.apiBaseUrl,
    configPath: resolveConfigPath({
      env,
      envVar: "AXIOM_AUTH_CONFIG_PATH",
      fileName: "axiom.json",
    }),
  };
};

export const clearStoredAxiomAuthConfig = async () => {
  await removeJsonConfig(AXIOM_AUTH_CONFIG_PATH);
};

export const disconnectAxiom = async () => {
  await clearStoredAxiomAuthConfig();
  return {
    disconnected: true,
    configPath: AXIOM_AUTH_CONFIG_PATH,
  };
};

/* v8 ignore start */
const renderAxiomPage = ({ csrfToken, message = "", defaults = {} }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Axiom Setup</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #17181c; }
      .wrap { max-width: 780px; margin: 32px auto; padding: 24px; }
      .panel { background: #fff; border: 1px solid #dde1ea; border-radius: 16px; padding: 24px; }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: #5e6573; }
      a { color: #c91b69; }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input { padding: 12px 14px; border-radius: 10px; border: 1px solid #dde1ea; font: inherit; background: white; }
      .message { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #fff1ec; color: #8f2719; }
      .callout { background: #f0f7ff; border-left: 4px solid #0b6dc7; padding: 12px 16px; border-radius: 6px; margin: 16px 0; color: #17181c; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; font: inherit; font-weight: 700; color: white; background: #c91b69; cursor: pointer; width: fit-content; }
      code { background: #eef0f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Connect Axiom</h1>
        <p>Axiom stores structured logs + OpenTelemetry traces. This MCP gives the agent a query surface against your datasets — debug production from chat.</p>

        <div class="callout">
          <strong>Token scope:</strong> create a token with <code>Query</code> permission (and optionally <code>Ingest</code> if you also want the agent to send events). Read-only Query is enough for the typical "what's broken in prod?" workflow.
        </div>

        <ol>
          <li>Open <a href="https://app.axiom.co/settings/api-tokens" target="_blank" rel="noreferrer">app.axiom.co/settings/api-tokens</a>.</li>
          <li>Click <strong>New API token</strong>.</li>
          <li>Name it something like <code>zero-frame-mcp</code>. Grant <strong>Query</strong> at minimum.</li>
          <li>Copy the token value (starts with <code>xaat-</code>) and paste below.</li>
          <li>Optionally pick a default dataset so queries that omit one route there.</li>
        </ol>

        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Axiom API token
            <input name="token" type="password" required placeholder="xaat-..." />
          </label>
          <label>
            Default dataset (optional)
            <input name="defaultDataset" type="text" value="${escapeHtml(defaults.defaultDataset ?? "")}" placeholder="my-app-prod" />
          </label>
          <button type="submit">Save Axiom Token</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

export const runAxiomBrowserAuthFlow = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const status = getAxiomAuthStatus();
  const csrfToken = randomUUID();

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
        response.end(
          renderAxiomPage({
            csrfToken,
            defaults: { defaultDataset: status.defaultDataset ?? "" },
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
            response.end(
              renderAxiomPage({
                csrfToken,
                message: "Invalid CSRF token. Reload the page and try again.",
                defaults: body,
              }),
            );
            return;
          }

          const token = String(body.token ?? "").trim();
          const defaultDataset = String(body.defaultDataset ?? "").trim();

          if (!token) {
            throw new Error("Axiom API token is required.");
          }

          // Probe the token before saving — hit /v1/datasets and ensure it
          // succeeds. Catches typos and revoked tokens.
          const probeResponse = await fetch(
            `${DEFAULT_AXIOM_API_BASE_URL}/v1/datasets`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!probeResponse.ok) {
            const text = await probeResponse.text().catch(() => "");
            throw new Error(
              `Token rejected by Axiom (HTTP ${probeResponse.status}): ${text.slice(0, 200) || probeResponse.statusText}`,
            );
          }

          await saveAxiomAuthConfig({ token, defaultDataset });

          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Axiom connected</title></head>
<body style="font-family:ui-sans-serif,sans-serif;padding:32px;background:#f6f7fb;color:#17181c;">
<h1>Axiom connected</h1>
<p>Token saved to <code>${escapeHtml(AXIOM_AUTH_CONFIG_PATH)}</code>.</p>
<p>You can close this window. The Axiom MCP will read it automatically.</p>
</body></html>`);

          finish(() =>
            resolve({
              ok: true,
              configPath: AXIOM_AUTH_CONFIG_PATH,
              defaultDataset: defaultDataset || null,
              apiBaseUrl: DEFAULT_AXIOM_API_BASE_URL,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown Axiom setup error.";
          response.writeHead(400, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            renderAxiomPage({
              csrfToken,
              message,
              defaults: body,
            }),
          );
        }
        return;
      }

      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    });

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(new Error("Timed out waiting for Axiom browser setup.")),
      );
    }, timeoutMs);

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(() =>
          reject(new Error("Could not determine Axiom setup server address.")),
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
