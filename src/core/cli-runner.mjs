// Shared CLI runner — the third consumer surface for agentic-devtools.
//
// agentic-devtools exposes the same operations through THREE surfaces, all
// thin frontends over the provider client (the library surface):
//
//   library:  import { createAxiomClient } from "@vucinatim/agentic-devtools"
//   mcp:      agentic-devtools mcp axiom        (stdio MCP protocol)
//   cli:      agentic-devtools axiom <op> ...   (argv in, JSON out)  ← this file
//
// MCP and CLI are the SAME wrapped handler, differing only in transport. Each
// provider defines an `operations` registry; `mcp.mjs` registers each op as an
// MCP tool, and this runner dispatches each op from argv. Both wrap the handler
// with `wrapToolHandler(handler, { mapError })`, so the structured-error
// contract ({ code, remediation, ... }) is identical across both surfaces by
// construction — the CLI just unwraps `result.structuredContent` and sets the
// exit code from `result.isError`.
//
// An operation entry:
//   {
//     cliName: "list-datasets",        // kebab-case; the CLI subcommand
//     mcpName: "listAxiomDatasets",    // existing MCP tool name (preserved)
//     description: "…",
//     inputSchema: { name: z.string() } | undefined,   // zod raw shape (MCP)
//     parseArgs: (options) => ({...}), // optional: map CLI flags → handler args
//     handler: (args, extra) => …,     // the shared handler (calls the client)
//   }

import { printJson, wrapToolHandler } from "./result.mjs";

// -- argv parsing ------------------------------------------------------------
// Lifted here so all three providers' CLIs share one parser (previously this
// lived inline in railway/cli.mjs).

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

export const parseOptions = (argv) => {
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

export const getStringOption = (options, key) => {
  const value = options[key];
  if (Array.isArray(value)) return String(value[value.length - 1]).trim();
  if (typeof value === "string") return value.trim();
  return null;
};

export const getBooleanOption = (options, key) => {
  const value = options[key];
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  const normalized = String(Array.isArray(value) ? value.at(-1) : value)
    .trim()
    .toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  throw new Error(`Invalid boolean value for --${key}: ${value}`);
};

export const getIntegerOption = (options, key) => {
  const value = options[key];
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(
    String(Array.isArray(value) ? value.at(-1) : value),
    10,
  );
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer value for --${key}: ${value}`);
  }
  return parsed;
};

export const getJsonOption = (options, key) => {
  const raw = getStringOption(options, key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid JSON for --${key}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
};

// -- the runner --------------------------------------------------------------

/**
 * Build the default args for an operation from parsed CLI options.
 *
 * Resolution order:
 *   1. `--json '{...}'`        — full args object (escape hatch, mirrors MCP)
 *   2. op.parseArgs(options)   — provider-specific flag mapping, if defined
 *   3. fall back to passing the raw options object through
 *
 * `--json` always wins so the agent can drive any op exactly as it would the
 * MCP tool, even ops without a hand-written parseArgs.
 */
const resolveArgs = (op, options) => {
  const jsonArgs = getJsonOption(options, "json");
  if (jsonArgs !== undefined) return jsonArgs;
  if (typeof op.parseArgs === "function") return op.parseArgs(options);
  // Default: pass the parsed flags as-is (camelCase consumers should define
  // parseArgs; this is a permissive fallback).
  const { json: _json, ...rest } = options;
  return rest;
};

const renderUsage = (provider, operations) => {
  const lines = [
    `Usage: agentic-devtools ${provider} <operation> [--flags | --json '{...}']`,
    "",
    "Operations:",
  ];
  for (const op of operations) {
    lines.push(`  ${op.cliName.padEnd(28)} ${op.description ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push("Every operation also accepts --json '{...}' to pass the exact");
  lines.push("argument object the MCP tool would take. Output is JSON.");
  lines.push("");
  return `${lines.join("\n")}\n`;
};

/**
 * Dispatch one CLI invocation against a provider's operations registry.
 *
 * @param {object} cfg
 * @param {string} cfg.provider       provider name (for usage text)
 * @param {Array}  cfg.operations     the provider's operations registry
 * @param {Function} cfg.createClient factory → the provider client
 * @param {Function} [cfg.mapError]   provider error mapper (same as MCP)
 * @param {string[]} argv             args after `agentic-devtools <provider>`
 *
 * Prints JSON to stdout and calls process.exit. On a mapped error, prints the
 * structured `{ error, code, remediation, ... }` object and exits 1.
 */
export const runOperationsCli = async (cfg, argv) => {
  const { provider, operations, createClient, mapError } = cfg;
  const { positionals, options } = parseOptions(argv);
  const command = positionals[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(renderUsage(provider, operations));
    process.exit(0);
  }

  const op = operations.find((entry) => entry.cliName === command);
  if (!op) {
    process.stderr.write(
      `Unknown ${provider} operation: ${command}\nRun \`agentic-devtools ${provider} --help\`.\n`,
    );
    process.exit(1);
  }

  // Build the shared client once and inject it into the handler via `extra`,
  // matching how mcp.mjs supplies it. Handlers reference extra.client.
  const client = createClient();
  const wrapped = wrapToolHandler(op.handler, { mapError });

  let args;
  try {
    args = resolveArgs(op, options);
  } catch (error) {
    // Arg-parsing failure → emit a structured-ish error + exit 1.
    printJson({
      error: true,
      code: "VALIDATION_ERROR",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  const result = await wrapped(args, { client });
  printJson(result.structuredContent);
  process.exit(result.isError ? 1 : 0);
};
