import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const CONFIG_ROOT = path.join(os.homedir(), ".config", "agentic-devtools");

export const isTruthyEnv = (value) =>
  typeof value === "string" &&
  ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());

export const pickString = (value, fallback = undefined) => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
};

export const resolveConfigPath = ({ env, envVar, fileName }) => {
  const override = pickString(env?.[envVar]);
  return override ? path.resolve(override) : path.join(CONFIG_ROOT, fileName);
};

export const readJsonConfig = async (filePath) => {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

export const readJsonConfigSync = (filePath) => {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
};

export const writeJsonConfig = async (filePath, config) => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(config, null, 2)}\n`);
  await chmod(filePath, 0o600).catch(() => {});
};

export const removeJsonConfig = async (filePath) => {
  await rm(filePath, { force: true });
};

export const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const parseFormBody = async (request) => {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  const params = new URLSearchParams(body);

  return Object.fromEntries(params.entries());
};

/* v8 ignore start */
export const openBrowser = async (url, { skipEnvVar } = {}) => {
  if (skipEnvVar && isTruthyEnv(process.env[skipEnvVar])) {
    return;
  }

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
/* v8 ignore stop */
