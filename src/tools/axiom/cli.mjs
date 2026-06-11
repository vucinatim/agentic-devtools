// Axiom CLI surface. Thin frontend over the shared operations registry —
// same ops, same handlers, same structured errors as the MCP server.
//
//   agentic-devtools axiom <operation> [--flags | --json '{...}']
//
// Auth/setup (connect, auth-status, disconnect, test-connection) live as
// cross-provider subcommands in src/cli.mjs, not here.

import { runOperationsCli } from "../../core/cli-runner.mjs";
import { createAxiomClient } from "./client.mjs";
import { mapAxiomError } from "./error-mapper.mjs";
import { axiomOperations } from "./operations.mjs";

export const runAxiomCli = (argv) =>
  runOperationsCli(
    {
      provider: "axiom",
      operations: axiomOperations,
      createClient: createAxiomClient,
      mapError: mapAxiomError,
    },
    argv,
  );
