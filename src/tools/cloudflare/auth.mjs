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

export const DEFAULT_CLOUDFLARE_API_BASE_URL =
  "https://api.cloudflare.com/client/v4";

// "Working" token path — per-project when set by an MCP env override, global
// fallback when not. This is the token used for all day-to-day ops (R2 CRUD,
// DNS, Workers, etc.). Account-scoped under the two-tier model.
export const CLOUDFLARE_AUTH_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "CLOUDFLARE_AUTH_CONFIG_PATH",
  fileName: "cloudflare.json",
});

// "Bootstrap" token path — ALWAYS global. The bootstrap is a user-level token
// with `User: API Tokens: Edit` scope, used only at project-init time to mint
// account-scoped working tokens. Override via CLOUDFLARE_BOOTSTRAP_CONFIG_PATH
// only for testing; in real use the bootstrap is one-per-machine.
export const CLOUDFLARE_BOOTSTRAP_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "CLOUDFLARE_BOOTSTRAP_CONFIG_PATH",
  fileName: "cloudflare-bootstrap.json",
});

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const shouldReadStoredConfig = (env) =>
  env === process.env || typeof env.CLOUDFLARE_AUTH_CONFIG_PATH === "string";

const readStoredCloudflareAuthConfig = (env = process.env) => {
  if (!shouldReadStoredConfig(env)) {
    return null;
  }

  const configPath = resolveConfigPath({
    env,
    envVar: "CLOUDFLARE_AUTH_CONFIG_PATH",
    fileName: "cloudflare.json",
  });

  return readJsonConfigSync(configPath);
};

export const saveCloudflareAuthConfig = async ({
  token,
  defaultAccountId = "",
  defaultZoneId = "",
  apiBaseUrl = "",
} = {}) => {
  const config = {
    token: String(token ?? "").trim(),
    defaultAccountId: String(defaultAccountId ?? "").trim(),
    defaultZoneId: String(defaultZoneId ?? "").trim(),
    apiBaseUrl: String(apiBaseUrl ?? "").trim(),
    savedAt: new Date().toISOString(),
  };

  if (!config.token) {
    throw new Error("Missing token in Cloudflare auth config.");
  }

  await writeJsonConfig(CLOUDFLARE_AUTH_CONFIG_PATH, config);

  return {
    configPath: CLOUDFLARE_AUTH_CONFIG_PATH,
    defaultAccountId: config.defaultAccountId || null,
    defaultZoneId: config.defaultZoneId || null,
    apiBaseUrl: config.apiBaseUrl || DEFAULT_CLOUDFLARE_API_BASE_URL,
  };
};

export const resolveCloudflareAuthConfig = (env = process.env) => {
  const envToken = pickString(env.CLOUDFLARE_API_TOKEN);
  if (envToken) {
    return {
      token: envToken,
      defaultAccountId: pickString(env.CLOUDFLARE_ACCOUNT_ID) ?? null,
      defaultZoneId: pickString(env.CLOUDFLARE_ZONE_ID) ?? null,
      apiBaseUrl:
        pickString(env.CLOUDFLARE_API_BASE_URL) ??
        DEFAULT_CLOUDFLARE_API_BASE_URL,
      source: "env:CLOUDFLARE_API_TOKEN",
    };
  }

  const stored = readStoredCloudflareAuthConfig(env);
  if (stored?.token) {
    const storedApiBaseUrl = pickString(stored.apiBaseUrl) ?? undefined;
    return {
      token: stored.token,
      defaultAccountId:
        pickString(env.CLOUDFLARE_ACCOUNT_ID, stored.defaultAccountId) ?? null,
      defaultZoneId:
        pickString(env.CLOUDFLARE_ZONE_ID, stored.defaultZoneId) ?? null,
      apiBaseUrl:
        pickString(env.CLOUDFLARE_API_BASE_URL, storedApiBaseUrl) ??
        DEFAULT_CLOUDFLARE_API_BASE_URL,
      source: "file",
    };
  }

  return {
    token: null,
    defaultAccountId: pickString(env.CLOUDFLARE_ACCOUNT_ID) ?? null,
    defaultZoneId: pickString(env.CLOUDFLARE_ZONE_ID) ?? null,
    apiBaseUrl:
      pickString(env.CLOUDFLARE_API_BASE_URL) ??
      DEFAULT_CLOUDFLARE_API_BASE_URL,
    source: null,
  };
};

export const getCloudflareAuthStatus = (env = process.env) => {
  const auth = resolveCloudflareAuthConfig(env);
  return {
    configured: Boolean(auth.token),
    source: auth.source,
    defaultAccountId: auth.defaultAccountId,
    defaultZoneId: auth.defaultZoneId,
    apiBaseUrl: auth.apiBaseUrl,
    configPath: resolveConfigPath({
      env,
      envVar: "CLOUDFLARE_AUTH_CONFIG_PATH",
      fileName: "cloudflare.json",
    }),
  };
};

export const clearStoredCloudflareAuthConfig = async () => {
  await removeJsonConfig(CLOUDFLARE_AUTH_CONFIG_PATH);
};

export const disconnectCloudflare = async () => {
  await clearStoredCloudflareAuthConfig();
  return {
    disconnected: true,
    configPath: CLOUDFLARE_AUTH_CONFIG_PATH,
  };
};

// -- Bootstrap (global, rarely used) ----------------------------------------

const readStoredBootstrap = (env = process.env) => {
  const configPath = resolveConfigPath({
    env,
    envVar: "CLOUDFLARE_BOOTSTRAP_CONFIG_PATH",
    fileName: "cloudflare-bootstrap.json",
  });
  return readJsonConfigSync(configPath);
};

export const saveCloudflareBootstrapToken = async ({ token } = {}) => {
  const config = {
    type: "bootstrap",
    token: String(token ?? "").trim(),
    savedAt: new Date().toISOString(),
  };
  if (!config.token) {
    throw new Error("Missing token for Cloudflare bootstrap.");
  }
  await writeJsonConfig(CLOUDFLARE_BOOTSTRAP_CONFIG_PATH, config);
  return { configPath: CLOUDFLARE_BOOTSTRAP_CONFIG_PATH };
};

/**
 * Return the bootstrap token (or null if not configured). The bootstrap is
 * used only for token-minting operations — never for daily ops.
 */
export const getCloudflareBootstrapToken = (env = process.env) => {
  const envToken = pickString(env.CLOUDFLARE_BOOTSTRAP_TOKEN);
  if (envToken) {
    return { token: envToken, source: "env:CLOUDFLARE_BOOTSTRAP_TOKEN" };
  }
  const stored = readStoredBootstrap(env);
  if (stored?.token) {
    return { token: stored.token, source: "file:bootstrap" };
  }
  return { token: null, source: null };
};

export const getCloudflareBootstrapStatus = (env = process.env) => {
  const b = getCloudflareBootstrapToken(env);
  return {
    configured: Boolean(b.token),
    source: b.source,
    configPath: CLOUDFLARE_BOOTSTRAP_CONFIG_PATH,
  };
};

export const clearStoredCloudflareBootstrap = async () => {
  await removeJsonConfig(CLOUDFLARE_BOOTSTRAP_CONFIG_PATH);
};

/**
 * Browser-based bootstrap flow. Identical mechanics to the working-token
 * browser flow, with copy that directs the user at Cloudflare's "Create
 * Additional Tokens" template (one click in the dashboard, pre-selects the
 * only scope a bootstrap needs: `User: API Tokens: Edit`).
 *
 * Saves to CLOUDFLARE_BOOTSTRAP_CONFIG_PATH (global). After this runs once
 * per machine, all per-project working tokens are minted from it.
 */
/* v8 ignore start */
export const runCloudflareBootstrapFlow = async ({
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const csrfToken = randomUUID();

  const renderBootstrapPage = ({ message = "" }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cloudflare Bootstrap</title>
    <style>
      body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7fb; color: #17181c; }
      .wrap { max-width: 780px; margin: 32px auto; padding: 24px; }
      .panel { background: #ffffff; border: 1px solid #dde1ea; border-radius: 16px; padding: 24px; }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: #5e6573; }
      a { color: #f48120; }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input { padding: 12px 14px; border-radius: 10px; border: 1px solid #dde1ea; font: inherit; background: white; }
      .message { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #fff1ec; color: #8f2719; }
      .callout { background: #f0f7ff; border-left: 4px solid #0b6dc7; padding: 12px 16px; border-radius: 6px; margin: 16px 0; color: #17181c; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; font: inherit; font-weight: 700; color: white; background: #f48120; cursor: pointer; width: fit-content; }
      code { background: #eef0f6; padding: 2px 6px; border-radius: 6px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="panel">
        <h1>Bootstrap Cloudflare</h1>
        <p>You'll do this once per machine. After bootstrap, every Zeroframe project gets its own account-scoped working token automatically — no more dashboard clicks.</p>

        <div class="callout">
          <strong>One template, one click.</strong> Cloudflare ships a built-in template called <strong>“Create Additional Tokens”</strong> that pre-selects exactly the one scope a bootstrap needs (<code>User → API Tokens → Edit</code>). You do <em>not</em> need to find anything in the 200-row Custom Token list.
        </div>

        <ol>
          <li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">dash.cloudflare.com/profile/api-tokens</a>.</li>
          <li>Click <strong>Create Token</strong>.</li>
          <li>Find the row titled <strong>“Create Additional Tokens”</strong> → click <strong>Use template</strong>.</li>
          <li>(Optional) Leave Account Resources as “All accounts”. Click <strong>Continue to summary</strong> → <strong>Create Token</strong>.</li>
          <li>Copy the token value (shown once) and paste it below.</li>
        </ol>

        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Cloudflare bootstrap token
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

          // Probe the token by hitting /user/tokens/verify with it. This catches
          // typos + invalid tokens before we persist anything.
          const verifyResponse = await fetch(
            `${DEFAULT_CLOUDFLARE_API_BASE_URL}/user/tokens/verify`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          const verifyPayload = await verifyResponse.json().catch(() => ({}));
          if (!verifyResponse.ok || !verifyPayload?.success) {
            const msg = (verifyPayload?.errors ?? [])
              .map((e) => e?.message)
              .filter(Boolean)
              .join(" | ");
            throw new Error(
              `Token rejected by Cloudflare: ${msg || verifyResponse.statusText}`,
            );
          }

          await saveCloudflareBootstrapToken({ token });

          response.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(`<!doctype html>
<html><head><meta charset="utf-8"/><title>Bootstrap saved</title></head>
<body style="font-family:ui-sans-serif,sans-serif;padding:32px;background:#f6f7fb;color:#17181c;">
<h1>Bootstrap saved</h1>
<p>Stored at <code>${escapeHtml(CLOUDFLARE_BOOTSTRAP_CONFIG_PATH)}</code>.</p>
<p>You can close this window. Zeroframe will use this token to mint
account-scoped working tokens for each project automatically.</p>
</body></html>`);

          finish(() =>
            resolve({
              ok: true,
              configPath: CLOUDFLARE_BOOTSTRAP_CONFIG_PATH,
              tokenId: verifyPayload?.result?.id ?? null,
              status: verifyPayload?.result?.status ?? null,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown Cloudflare bootstrap error.";
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
        reject(new Error("Timed out waiting for Cloudflare bootstrap.")),
      );
    }, timeoutMs);

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(() =>
          reject(new Error("Could not determine bootstrap server address.")),
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

/* v8 ignore start */
const renderCloudflarePage = ({ csrfToken, message = "", defaults = {} }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Cloudflare Setup</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7fb;
        --panel: #ffffff;
        --text: #17181c;
        --muted: #5e6573;
        --accent: #f48120;
        --border: #dde1ea;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      .wrap { max-width: 780px; margin: 32px auto; padding: 24px; }
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
      input {
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
        background: #eef0f6;
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
        <h1>Connect Cloudflare</h1>
        <p>Use a scoped Cloudflare API token. This tool is designed around DNS and R2 bucket management, not the legacy global API key.</p>
        <ol>
          <li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Cloudflare API tokens</a>.</li>
          <li>Create a token with the narrowest scopes that fit your task. For DNS and R2, include <code>Zone Read</code>, <code>DNS Read</code>, <code>DNS Write</code>, <code>Workers R2 Storage Read</code>, and <code>Workers R2 Storage Edit</code>.</li>
          <li>Optionally paste a default account ID and zone ID to save repetitive inputs in the MCP tools.</li>
        </ol>
        ${message ? `<div class="message">${escapeHtml(message)}</div>` : ""}
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Cloudflare API Token
            <input name="token" type="password" required />
          </label>
          <div class="row">
            <label>
              Default Account ID (optional)
              <input name="defaultAccountId" type="text" value="${escapeHtml(defaults.defaultAccountId ?? "")}" />
            </label>
            <label>
              Default Zone ID (optional)
              <input name="defaultZoneId" type="text" value="${escapeHtml(defaults.defaultZoneId ?? "")}" />
            </label>
          </div>
          <label>
            API Base URL Override (optional)
            <input name="apiBaseUrl" type="text" value="${escapeHtml(defaults.apiBaseUrl ?? "")}" placeholder="${DEFAULT_CLOUDFLARE_API_BASE_URL}" />
          </label>
          <button type="submit">Save Cloudflare Token</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

export const runCloudflareBrowserAuthFlow = async ({
  validateConnection = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const status = getCloudflareAuthStatus();
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
          renderCloudflarePage({
            csrfToken,
            defaults: {
              defaultAccountId: status.defaultAccountId ?? "",
              defaultZoneId: status.defaultZoneId ?? "",
              apiBaseUrl:
                status.apiBaseUrl === DEFAULT_CLOUDFLARE_API_BASE_URL
                  ? ""
                  : status.apiBaseUrl,
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
            response.end(
              renderCloudflarePage({
                csrfToken,
                message: "Invalid CSRF token. Reload the page and try again.",
                defaults: body,
              }),
            );
            return;
          }

          const token = String(body.token ?? "").trim();
          const defaultAccountId = String(body.defaultAccountId ?? "").trim();
          const defaultZoneId = String(body.defaultZoneId ?? "").trim();
          const apiBaseUrl = String(body.apiBaseUrl ?? "").trim();

          if (!token) {
            throw new Error("Cloudflare API token is required.");
          }

          await saveCloudflareAuthConfig({
            token,
            defaultAccountId,
            defaultZoneId,
            apiBaseUrl,
          });

          let validation = null;
          if (validateConnection) {
            const { createCloudflareClient } = await import("./client.mjs");
            const client = createCloudflareClient({
              env: {
                CLOUDFLARE_AUTH_CONFIG_PATH: CLOUDFLARE_AUTH_CONFIG_PATH,
              },
            });
            validation = await client.validateToken();
          }

          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Cloudflare Connected</title></head>
  <body style="font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:32px;background:#f6f7fb;color:#17181c;">
    <h1>Cloudflare connected</h1>
    <p>Your Cloudflare token was saved to <code>${escapeHtml(CLOUDFLARE_AUTH_CONFIG_PATH)}</code>.</p>
    <p>You can close this window and run <code>agentic-devtools test-connection cloudflare</code>.</p>
  </body>
</html>`);

          finish(() =>
            resolve({
              ok: true,
              configPath: CLOUDFLARE_AUTH_CONFIG_PATH,
              defaultAccountId: defaultAccountId || null,
              defaultZoneId: defaultZoneId || null,
              apiBaseUrl: apiBaseUrl || DEFAULT_CLOUDFLARE_API_BASE_URL,
              validation,
            }),
          );
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Unknown Cloudflare setup error.";
          response.writeHead(400, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            renderCloudflarePage({
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
        reject(new Error("Timed out waiting for Cloudflare browser setup.")),
      );
    }, timeoutMs);

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        finish(() =>
          reject(new Error("Could not determine Cloudflare setup server address.")),
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
