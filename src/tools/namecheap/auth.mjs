import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import {
  CONFIG_ROOT,
  escapeHtml,
  isTruthyEnv,
  openBrowser,
  parseFormBody,
  pickString,
  readJsonConfigSync,
  removeJsonConfig,
  resolveConfigPath,
  writeJsonConfig,
} from "../../core/config-store.mjs";

const AUTH_CONFIG_PATH = resolveConfigPath({
  env: process.env,
  envVar: "NAMECHEAP_AUTH_CONFIG_PATH",
  fileName: "namecheap.json",
});
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const resolveStoredConfigSync = () => {
  const stored = readJsonConfigSync(AUTH_CONFIG_PATH);
  if (stored) {
    return stored;
  }

  const legacyPath = AUTH_CONFIG_PATH.endsWith("namecheap.json")
    ? AUTH_CONFIG_PATH.replace(/namecheap\.json$/, "namecheap-auth.json")
    : null;

  return legacyPath ? readJsonConfigSync(legacyPath) : null;
};

// Single sync source of truth for resolved Namecheap credentials — matches how
// every other provider's client auto-resolves: explicit overrides → env vars →
// stored config file. `createNamecheapClient` uses this so it "just works" like
// `createRailwayClient()` etc., without a separate resolved-factory.
export const resolveNamecheapCredentials = (overrides = {}) => {
  const stored = resolveStoredConfigSync();
  const sandboxEnv = process.env.NAMECHEAP_API_SANDBOX;
  // pickString(value, fallback) is 2-arity, so chain by precedence:
  // explicit override → env var → stored file.
  const pick = (override, envValue, storedValue) =>
    pickString(override, pickString(envValue, storedValue));
  const apiUser = pick(
    overrides.apiUser,
    process.env.NAMECHEAP_API_USER,
    stored?.apiUser,
  );
  return {
    apiUser,
    apiKey: pick(overrides.apiKey, process.env.NAMECHEAP_API_KEY, stored?.apiKey),
    // Namecheap UserName defaults to ApiUser for non-reseller accounts.
    username:
      pick(
        overrides.username,
        process.env.NAMECHEAP_USERNAME,
        stored?.username,
      ) ?? apiUser,
    clientIp: pick(
      overrides.clientIp,
      process.env.NAMECHEAP_CLIENT_IP,
      stored?.clientIp,
    ),
    baseUrl: pick(
      overrides.baseUrl,
      process.env.NAMECHEAP_API_BASE_URL,
      stored?.baseUrl,
    ),
    sandbox:
      typeof overrides.sandbox === "boolean"
        ? overrides.sandbox
        : sandboxEnv != null
          ? isTruthyEnv(sandboxEnv)
          : typeof stored?.sandbox === "boolean"
            ? stored.sandbox
            : false,
  };
};

export const resolvePublicIpv4 = async ({
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
} = {}) => {
  if (typeof fetchImpl !== "function") {
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    const payload = await response.json();
    const ip = typeof payload?.ip === "string" ? payload.ip.trim() : "";
    return isIP(ip) === 4 ? ip : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
};

export const getResolvedAuthConfig = async () => {
  const config = resolveNamecheapCredentials();
  const usingEnv = Boolean(
    process.env.NAMECHEAP_API_USER ||
      process.env.NAMECHEAP_API_KEY ||
      process.env.NAMECHEAP_USERNAME ||
      process.env.NAMECHEAP_CLIENT_IP,
  );
  const source = usingEnv ? "env" : resolveStoredConfigSync() ? "file" : "none";

  return { ...config, source };
};

export const getAuthStatus = async () => {
  const config = await getResolvedAuthConfig();
  const hasCredentials = Boolean(
    config.apiUser && config.apiKey && config.username && config.clientIp,
  );

  return {
    configured: hasCredentials,
    source: config.source,
    sandbox: config.sandbox,
    baseUrl: config.baseUrl || null,
    hasApiUser: Boolean(config.apiUser),
    hasApiKey: Boolean(config.apiKey),
    hasUsername: Boolean(config.username),
    hasClientIp: Boolean(config.clientIp),
    configPath: AUTH_CONFIG_PATH,
  };
};

export const saveAuthConfig = async ({
  apiUser,
  apiKey,
  username,
  clientIp,
  sandbox = false,
  baseUrl = "",
} = {}) => {
  const config = {
    apiUser: String(apiUser ?? "").trim(),
    apiKey: String(apiKey ?? "").trim(),
    username: String(username ?? "").trim(),
    clientIp: String(clientIp ?? "").trim(),
    sandbox: Boolean(sandbox),
    baseUrl: String(baseUrl ?? "").trim(),
    savedAt: new Date().toISOString(),
  };

  for (const [key, value] of Object.entries(config)) {
    if (
      ["apiUser", "apiKey", "username", "clientIp"].includes(key) &&
      (!value || String(value).trim().length === 0)
    ) {
      throw new Error(`Missing ${key} in Namecheap auth config.`);
    }
  }

  await writeJsonConfig(AUTH_CONFIG_PATH, config);

  return {
    configPath: AUTH_CONFIG_PATH,
    sandbox: config.sandbox,
  };
};

/* v8 ignore start */
const renderPage = ({ csrfToken, message = "", defaults = {} }) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Namecheap Setup</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f5efe8;
        --panel: #fffaf5;
        --text: #1f1a16;
        --muted: #6f6258;
        --accent: #de3723;
        --border: #e5d3c4;
      }
      body {
        margin: 0;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: radial-gradient(circle at top, #fff3ea, var(--bg));
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
        border-radius: 20px;
        padding: 24px;
        box-shadow: 0 20px 50px rgba(70, 43, 20, 0.08);
      }
      h1 { margin-top: 0; font-size: 28px; }
      p, li { line-height: 1.5; color: var(--muted); }
      a { color: var(--accent); }
      form { display: grid; gap: 16px; margin-top: 24px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input[type="text"], input[type="password"] {
        padding: 12px 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        font: inherit;
        background: white;
      }
      .row { display: grid; gap: 16px; grid-template-columns: 1fr 1fr; }
      .message {
        margin-top: 16px;
        padding: 12px 14px;
        border-radius: 12px;
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
        background: #f1e3d6;
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
        <h1>Connect Namecheap</h1>
        <p>Namecheap does not use OAuth here. You need to generate an API key in Namecheap and whitelist your IPv4 address, then paste the values below.</p>
        ${
          defaults.detectedClientIp
            ? `<p>Detected public IPv4: <code>${escapeHtml(defaults.detectedClientIp)}</code></p>`
            : ""
        }
        <ol>
          <li>Open <a href="https://ap.www.namecheap.com/settings/tools/apiaccess/" target="_blank" rel="noreferrer">Namecheap API Access</a>, toggle it <strong>ON</strong>, and whitelist the IPv4 above (it must match <code>Client IP</code> below).</li>
          <li>Copy your <strong>API Key</strong> and enter your Namecheap <strong>username</strong> below.</li>
          <li>Leave <strong>Use Sandbox account</strong> unchecked for your real account. (Sandbox is a separate test environment with its own login + key — only for scripting against fake domains. <a href="https://www.namecheap.com/support/knowledgebase/article.aspx/763/63/what-is-sandbox/" target="_blank" rel="noreferrer">What's Sandbox?</a>)</li>
        </ol>
        ${
          message
            ? `<div class="message">${escapeHtml(message)}</div>`
            : ""
        }
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <label>
            Namecheap Username
            <input name="username" type="text" value="${escapeHtml(defaults.username ?? defaults.apiUser ?? "")}" required />
          </label>
          <label>
            API Key
            <input name="apiKey" type="password" value="${escapeHtml(defaults.apiKey ?? "")}" required />
          </label>
          <div class="row">
            <label>
              Client IP (must be whitelisted in Namecheap)
              <input name="clientIp" type="text" value="${escapeHtml(defaults.clientIp ?? "")}" required />
            </label>
            <label>
              API Base URL Override (optional)
              <input name="baseUrl" type="text" value="${escapeHtml(defaults.baseUrl ?? "")}" placeholder="https://api.namecheap.com/xml.response" />
            </label>
          </div>
          <label style="display:flex; align-items:center; gap:10px; font-weight:500;">
            <input name="sandbox" type="checkbox" value="1" ${defaults.sandbox ? "checked" : ""} />
            Use Sandbox account
          </label>
          <button type="submit">Save Namecheap Credentials</button>
        </form>
      </div>
    </div>
  </body>
</html>`;

export const runBrowserAuthFlow = async ({
  defaultSandbox = false,
  fetchImpl = globalThis.fetch,
  validateConnection = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const existing = await getResolvedAuthConfig();
  const detectedClientIp = existing.clientIp
    ? null
    : await resolvePublicIpv4({ fetchImpl });
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
          renderPage({
            csrfToken,
            defaults: {
              apiUser: existing.apiUser ?? "",
              username: existing.username ?? "",
              clientIp: existing.clientIp ?? detectedClientIp ?? "",
              detectedClientIp,
              baseUrl: existing.baseUrl ?? "",
              sandbox: existing.sandbox || defaultSandbox,
            },
          }),
        );
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/save") {
        try {
          const body = await parseFormBody(request);
          if (body.csrfToken !== csrfToken) {
            response.writeHead(403, {
              "content-type": "text/html; charset=utf-8",
            });
            response.end("Invalid CSRF token.");
            return;
          }

          // Namecheap's API takes both ApiUser (key owner) and UserName (account
          // acted on). They're identical except for resellers, so the form
          // collects one "username" and we use it for both. A reseller can still
          // override ApiUser via the NAMECHEAP_API_USER env var.
          const apiUser = body.apiUser || body.username;

          if (validateConnection) {
            const { createNamecheapClient } = await import("./client.mjs");
            const client = createNamecheapClient({
              apiUser,
              apiKey: body.apiKey,
              username: body.username,
              clientIp: body.clientIp,
              baseUrl: body.baseUrl,
              sandbox: body.sandbox === "1",
            });
            await client.listDomains({ page: 1, pageSize: 1 });
          }

          const saved = await saveAuthConfig({
            apiUser,
            apiKey: body.apiKey,
            username: body.username,
            clientIp: body.clientIp,
            baseUrl: body.baseUrl,
            sandbox: body.sandbox === "1",
          });

          response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          response.end(`<!doctype html><html><body style="font-family: sans-serif; padding: 24px;"><h1>Namecheap connected</h1><p>Credentials were saved to <code>${escapeHtml(saved.configPath)}</code>. You can close this tab.</p></body></html>`);
          finish(() => resolve(saved));
        } catch (error) {
          response.writeHead(400, {
            "content-type": "text/html; charset=utf-8",
          });
          response.end(
            renderPage({
              csrfToken,
              message:
                error instanceof Error ? error.message : String(error),
              defaults: {
                apiUser: "",
                username: "",
                clientIp: "",
                baseUrl: "",
                sandbox: defaultSandbox,
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
          throw new Error("Failed to bind local Namecheap auth server.");
        }

        const url = `http://127.0.0.1:${address.port}/`;
        await openBrowser(url, { skipEnvVar: "NAMECHEAP_SKIP_BROWSER_OPEN" });
      } catch (error) {
        finish(() => reject(error));
      }
    });

    timeoutId = setTimeout(() => {
      finish(() =>
        reject(
          new Error(
            "Timed out waiting for Namecheap browser setup to complete.",
          ),
        ),
      );
    }, timeoutMs);
  });
};
/* v8 ignore stop */

export const clearStoredAuthConfig = async () => {
  await removeJsonConfig(AUTH_CONFIG_PATH);
};

export const connectNamecheap = runBrowserAuthFlow;

export const disconnectNamecheap = async () => {
  await clearStoredAuthConfig();
  return {
    disconnected: true,
    configPath: AUTH_CONFIG_PATH,
  };
};

export { AUTH_CONFIG_PATH, CONFIG_ROOT };
