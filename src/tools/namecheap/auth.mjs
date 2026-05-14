import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const CONFIG_ROOT = path.join(os.homedir(), ".config", "agentic-devtools");
const AUTH_CONFIG_PATH = process.env.NAMECHEAP_AUTH_CONFIG_PATH
  ? path.resolve(process.env.NAMECHEAP_AUTH_CONFIG_PATH)
  : path.join(CONFIG_ROOT, "namecheap-auth.json");
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const isTruthyEnv = (value) =>
  typeof value === "string" &&
  ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());

const resolveStoredConfig = async () => {
  try {
    const raw = await readFile(AUTH_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return null;
      }
    }
    throw error;
  }
};

const pick = (value, fallback) => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

export const getResolvedAuthConfig = async () => {
  const stored = await resolveStoredConfig();
  const sandboxEnv = process.env.NAMECHEAP_API_SANDBOX;

  const config = {
    apiUser: pick(process.env.NAMECHEAP_API_USER, stored?.apiUser),
    apiKey: pick(process.env.NAMECHEAP_API_KEY, stored?.apiKey),
    username: pick(process.env.NAMECHEAP_USERNAME, stored?.username),
    clientIp: pick(process.env.NAMECHEAP_CLIENT_IP, stored?.clientIp),
    baseUrl: pick(process.env.NAMECHEAP_API_BASE_URL, stored?.baseUrl),
    sandbox:
      sandboxEnv != null
        ? isTruthyEnv(sandboxEnv)
        : typeof stored?.sandbox === "boolean"
          ? stored.sandbox
          : false,
    source:
      process.env.NAMECHEAP_API_USER ||
      process.env.NAMECHEAP_API_KEY ||
      process.env.NAMECHEAP_USERNAME ||
      process.env.NAMECHEAP_CLIENT_IP
        ? "env"
        : stored
          ? "file"
          : "none",
  };

  return config;
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

  await mkdir(path.dirname(AUTH_CONFIG_PATH), { recursive: true });
  await writeFile(AUTH_CONFIG_PATH, JSON.stringify(config, null, 2));
  await chmod(AUTH_CONFIG_PATH, 0o600).catch(() => {});

  return {
    configPath: AUTH_CONFIG_PATH,
    sandbox: config.sandbox,
  };
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const openBrowser = async (url) => {
  if (isTruthyEnv(process.env.NAMECHEAP_SKIP_BROWSER_OPEN)) {
    return;
  }

  const { execFile } = await import("node:child_process");

  await new Promise((resolve, reject) => {
    const platform = process.platform;
    let command;
    let args;

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    execFile(command, args, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
};

const parseFormBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const params = new URLSearchParams(body);

  return Object.fromEntries(params.entries());
};

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
        <ol>
          <li>Open <a href="https://www.namecheap.com/support/knowledgebase/article.aspx/763/63/what-is-sandbox/" target="_blank" rel="noreferrer">Sandbox setup</a> if you want safe testing first.</li>
          <li>Open <a href="https://ap.www.namecheap.com/settings/tools/apiaccess/" target="_blank" rel="noreferrer">production API access</a> or the Sandbox account’s API access page.</li>
          <li>Enable API access and whitelist the same IPv4 address you enter as <code>Client IP</code>.</li>
          <li>Copy your API user, API key, and username into this form.</li>
        </ol>
        ${
          message
            ? `<div class="message">${escapeHtml(message)}</div>`
            : ""
        }
        <form method="post" action="/save">
          <input type="hidden" name="csrfToken" value="${escapeHtml(csrfToken)}" />
          <div class="row">
            <label>
              API User
              <input name="apiUser" type="text" value="${escapeHtml(defaults.apiUser ?? "")}" required />
            </label>
            <label>
              Username
              <input name="username" type="text" value="${escapeHtml(defaults.username ?? "")}" required />
            </label>
          </div>
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
  defaultSandbox = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const existing = await getResolvedAuthConfig();
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
              clientIp: existing.clientIp ?? "",
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

          const saved = await saveAuthConfig({
            apiUser: body.apiUser,
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
        await openBrowser(url);
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

export const clearStoredAuthConfig = async () => {
  await rm(AUTH_CONFIG_PATH, { force: true });
};

export { AUTH_CONFIG_PATH, CONFIG_ROOT };
