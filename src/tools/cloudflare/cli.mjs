// Cloudflare CLI surface. Thin frontend over the shared operations list and
// the Cloudflare client — same client, same structured errors as the MCP.
//
//   agentic-devtools cloudflare <operation> [--flags | --json '{...}']
//
// Auth/setup (connect, auth-status, disconnect, test-connection) live as
// cross-provider subcommands in src/cli.mjs.

import { runOperationsCli } from "../../core/cli-runner.mjs";
import { createCloudflareClient } from "./client.mjs";
import { mapCloudflareError } from "./error-mapper.mjs";
import { cloudflareOperations } from "./operations.mjs";

export const runCloudflareCli = (argv) =>
  runOperationsCli(
    {
      provider: "cloudflare",
      operations: cloudflareOperations,
      createClient: createCloudflareClient,
      mapError: mapCloudflareError,
    },
    argv,
  );
