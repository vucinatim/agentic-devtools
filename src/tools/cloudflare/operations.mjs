// Cloudflare CLI operation list — the CLI surface over the Cloudflare client.
//
// NOTE on architecture (read before "fixing" the asymmetry with axiom):
//   axiom is the reference full implementation — its mcp.mjs AND cli.mjs both
//   consume a single operations registry that also owns the zod input schemas.
//   Cloudflare (31 ops, complex DNS/R2/tunnel schemas) instead keeps its zod
//   schemas inline in mcp.mjs (untouched, battle-tested) and exposes the CLI
//   here over the SAME client. The shared core — the single source of truth
//   for logic — is the client (`createCloudflareClient`), which both surfaces
//   call. What's NOT yet shared is the schema-level metadata; converging
//   cloudflare's mcp.mjs to consume this registry (with MCP-introspection
//   snapshot tests to prove no tool/schema drift) is tracked follow-up.
//
// Every op handler is `(args, { client }) => client.<method>(args)`. The CLI
// runner wraps it with the same `wrapToolHandler(handler, { mapError })` the
// MCP uses, so the structured-error contract is identical. Complex/object args
// (DNS `data`, tunnel `config`, R2 token scopes) are passed via `--json`;
// `parseArgs` covers the common scalar flags for ergonomics.

import { getBooleanOption, getStringOption } from "../../core/cli-runner.mjs";

// Common selector flags shared by most account/zone-scoped ops.
const account = (o) => ({
  accountId: getStringOption(o, "account-id") ?? undefined,
  accountName: getStringOption(o, "account-name") ?? undefined,
});
const zone = (o) => ({
  zoneId: getStringOption(o, "zone-id") ?? undefined,
  zoneName: getStringOption(o, "zone-name") ?? undefined,
});
const tunnel = (o) => ({
  ...account(o),
  tunnelId: getStringOption(o, "tunnel-id") ?? undefined,
  tunnelName: getStringOption(o, "tunnel-name") ?? undefined,
});
// Drop undefined keys so they don't override client defaults / env fallbacks.
const clean = (obj) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

const op = (cliName, mcpName, method, description, parseArgs) => ({
  cliName,
  mcpName,
  description,
  handler: (args, { client }) => client[method](args),
  parseArgs: parseArgs ?? (() => ({})),
});

export const cloudflareOperations = [
  // -- Accounts / zones -----------------------------------------------------
  op(
    "list-accounts",
    "listCloudflareAccounts",
    "listAccounts",
    "List Cloudflare accounts accessible to the token. Use to target R2 ops by account name.",
    (o) => clean({ name: getStringOption(o, "name") ?? undefined }),
  ),
  op(
    "list-zones",
    "listCloudflareZones",
    "listZones",
    "List Cloudflare zones accessible to the token.",
    (o) =>
      clean({
        accountId: getStringOption(o, "account-id") ?? undefined,
        name: getStringOption(o, "name") ?? undefined,
        status: getStringOption(o, "status") ?? undefined,
      }),
  ),
  op(
    "get-zone",
    "getCloudflareZone",
    "getZone",
    "Get Cloudflare zone details (pass --zone-id or set CLOUDFLARE_ZONE_ID).",
    (o) => getStringOption(o, "zone-id") ?? undefined,
  ),

  // -- DNS ------------------------------------------------------------------
  op(
    "list-dns",
    "listCloudflareDnsRecords",
    "listDnsRecords",
    "List DNS records in a zone.",
    (o) =>
      clean({
        ...zone(o),
        name: getStringOption(o, "name") ?? undefined,
        type: getStringOption(o, "type") ?? undefined,
        content: getStringOption(o, "content") ?? undefined,
      }),
  ),
  op(
    "get-dns",
    "getCloudflareDnsRecord",
    "getDnsRecord",
    "Get one DNS record by id.",
    (o) => clean({ ...zone(o), recordId: getStringOption(o, "record-id") }),
  ),
  op(
    "create-dns",
    "createCloudflareDnsRecord",
    "createDnsRecord",
    "Create a DNS record. For SRV/complex records use --json to pass `data`.",
    (o) =>
      clean({
        ...zone(o),
        type: getStringOption(o, "type"),
        name: getStringOption(o, "name"),
        content: getStringOption(o, "content"),
        proxied: getBooleanOption(o, "proxied"),
        comment: getStringOption(o, "comment") ?? undefined,
      }),
  ),
  op(
    "update-dns",
    "updateCloudflareDnsRecord",
    "updateDnsRecord",
    "Update a DNS record by id.",
    (o) =>
      clean({
        ...zone(o),
        recordId: getStringOption(o, "record-id"),
        type: getStringOption(o, "type") ?? undefined,
        name: getStringOption(o, "name") ?? undefined,
        content: getStringOption(o, "content") ?? undefined,
        proxied: getBooleanOption(o, "proxied"),
      }),
  ),
  op(
    "delete-dns",
    "deleteCloudflareDnsRecord",
    "deleteDnsRecord",
    "Delete a DNS record by id.",
    (o) => clean({ ...zone(o), recordId: getStringOption(o, "record-id") }),
  ),

  // -- R2 buckets -----------------------------------------------------------
  op(
    "list-r2-buckets",
    "listCloudflareR2Buckets",
    "listR2Buckets",
    "List R2 buckets in an account.",
    (o) => clean(account(o)),
  ),
  op(
    "get-r2-bucket",
    "getCloudflareR2Bucket",
    "getR2Bucket",
    "Get one R2 bucket.",
    (o) => clean({ ...account(o), bucketName: getStringOption(o, "bucket-name") }),
  ),
  op(
    "create-r2-bucket",
    "createCloudflareR2Bucket",
    "createR2Bucket",
    "Create an R2 bucket. Optional --location / --storage-class / --jurisdiction.",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        locationHint: getStringOption(o, "location") ?? undefined,
        storageClass: getStringOption(o, "storage-class") ?? undefined,
        jurisdiction: getStringOption(o, "jurisdiction") ?? undefined,
      }),
  ),
  op(
    "delete-r2-bucket",
    "deleteCloudflareR2Bucket",
    "deleteR2Bucket",
    "Delete an R2 bucket (must be empty).",
    (o) => clean({ ...account(o), bucketName: getStringOption(o, "bucket-name") }),
  ),
  op(
    "create-r2-api-token",
    "createCloudflareR2ApiToken",
    "createR2ApiToken",
    "Mint an S3-compatible R2 access key scoped to a bucket. Returns accessKeyId + secretAccessKey + endpoint. Use --json for full control over permission/scope.",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name") ?? undefined,
        tokenName: getStringOption(o, "token-name") ?? undefined,
        permission: getStringOption(o, "permission") ?? undefined,
      }),
  ),

  // -- R2 managed / custom domains ------------------------------------------
  op(
    "get-r2-managed-domain",
    "getCloudflareR2ManagedDomain",
    "getR2ManagedDomain",
    "Get the r2.dev managed-domain status for a bucket.",
    (o) => clean({ ...account(o), bucketName: getStringOption(o, "bucket-name") }),
  ),
  op(
    "update-r2-managed-domain",
    "updateCloudflareR2ManagedDomain",
    "updateR2ManagedDomain",
    "Enable/disable the r2.dev managed public domain for a bucket (--enabled true|false).",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        enabled: getBooleanOption(o, "enabled"),
      }),
  ),
  op(
    "list-r2-custom-domains",
    "listCloudflareR2CustomDomains",
    "listR2CustomDomains",
    "List custom domains attached to an R2 bucket.",
    (o) => clean({ ...account(o), bucketName: getStringOption(o, "bucket-name") }),
  ),
  op(
    "get-r2-custom-domain",
    "getCloudflareR2CustomDomain",
    "getR2CustomDomain",
    "Get one R2 custom domain.",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        domain: getStringOption(o, "domain"),
      }),
  ),
  op(
    "create-r2-custom-domain",
    "createCloudflareR2CustomDomain",
    "createR2CustomDomain",
    "Attach a custom domain to an R2 bucket.",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        domain: getStringOption(o, "domain"),
        zoneId: getStringOption(o, "zone-id") ?? undefined,
      }),
  ),
  op(
    "update-r2-custom-domain",
    "updateCloudflareR2CustomDomain",
    "updateR2CustomDomain",
    "Update an R2 custom domain (TLS / min-TLS).",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        domain: getStringOption(o, "domain"),
      }),
  ),
  op(
    "delete-r2-custom-domain",
    "deleteCloudflareR2CustomDomain",
    "deleteR2CustomDomain",
    "Detach a custom domain from an R2 bucket.",
    (o) =>
      clean({
        ...account(o),
        bucketName: getStringOption(o, "bucket-name"),
        domain: getStringOption(o, "domain"),
      }),
  ),

  // -- Tunnels --------------------------------------------------------------
  op(
    "list-tunnels",
    "listCloudflareTunnels",
    "listTunnels",
    "List Cloudflare Tunnels in an account.",
    (o) =>
      clean({
        ...account(o),
        name: getStringOption(o, "name") ?? undefined,
        isDeleted: getBooleanOption(o, "is-deleted"),
      }),
  ),
  op(
    "get-tunnel",
    "getCloudflareTunnel",
    "getTunnel",
    "Get one Cloudflare Tunnel.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "create-tunnel",
    "createCloudflareTunnel",
    "createTunnel",
    "Create a Cloudflare Tunnel.",
    (o) =>
      clean({
        ...account(o),
        name: getStringOption(o, "name"),
        configSource: getStringOption(o, "config-source") ?? undefined,
        tunnelSecret: getStringOption(o, "tunnel-secret") ?? undefined,
      }),
  ),
  op(
    "update-tunnel",
    "updateCloudflareTunnel",
    "updateTunnel",
    "Rename a tunnel or rotate its secret.",
    (o) =>
      clean({
        ...tunnel(o),
        name: getStringOption(o, "name") ?? undefined,
        tunnelSecret: getStringOption(o, "tunnel-secret") ?? undefined,
      }),
  ),
  op(
    "delete-tunnel",
    "deleteCloudflareTunnel",
    "deleteTunnel",
    "Delete a Cloudflare Tunnel.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "get-tunnel-token",
    "getCloudflareTunnelToken",
    "getTunnelToken",
    "Get the connector token for a tunnel.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "get-tunnel-config",
    "getCloudflareTunnelConfiguration",
    "getTunnelConfiguration",
    "Get a tunnel's remote configuration.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "update-tunnel-config",
    "updateCloudflareTunnelConfiguration",
    "updateTunnelConfiguration",
    "Replace a tunnel's remote configuration. Pass `config` via --json.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "list-tunnel-connections",
    "listCloudflareTunnelConnections",
    "listTunnelConnections",
    "List a tunnel's active/recent connections.",
    (o) => clean(tunnel(o)),
  ),
  op(
    "cleanup-tunnel-connections",
    "cleanupCloudflareTunnelConnections",
    "cleanupTunnelConnections",
    "Drop tracked connections for a tunnel (optionally one --client-id).",
    (o) =>
      clean({ ...tunnel(o), clientId: getStringOption(o, "client-id") ?? undefined }),
  ),
];
