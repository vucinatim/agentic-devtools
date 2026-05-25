import { createHash } from "node:crypto";
import {
  getCloudflarePermissionGroups,
  resolveCloudflarePermissionGroups,
} from "../../core/permission-group-resolver.mjs";
import {
  resolveSingleNamedResource as _resolveSingleNamedResource,
  matchesSelector as _matchesSelector,
} from "../../core/resolve-resource.mjs";
import {
  DEFAULT_CLOUDFLARE_API_BASE_URL,
  getCloudflareAuthStatus,
  getCloudflareBootstrapToken,
  resolveCloudflareAuthConfig,
} from "./auth.mjs";

export {
  DEFAULT_CLOUDFLARE_API_BASE_URL,
  getCloudflareAuthStatus,
  getCloudflareBootstrapToken,
  resolveCloudflareAuthConfig,
} from "./auth.mjs";

export {
  getCloudflarePermissionGroups,
} from "../../core/permission-group-resolver.mjs";

export class CloudflareApiError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CloudflareApiError";
    this.details = details;
  }
}

// Local wrappers that bind the lifted helpers to CloudflareApiError so
// resource-resolution errors carry the right class name.
const resolveSingleNamedResource = (opts) =>
  _resolveSingleNamedResource({ ...opts, ErrorClass: CloudflareApiError });

const matchesSelector = _matchesSelector;

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export const createCloudflareClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const auth = resolveCloudflareAuthConfig(env);
  const status = getCloudflareAuthStatus(env);
  const apiBaseUrl =
    status.apiBaseUrl?.replace(/\/+$/, "") || DEFAULT_CLOUDFLARE_API_BASE_URL;

  if (typeof fetchImpl !== "function") {
    throw new Error("Cloudflare client requires a fetch implementation.");
  }

  const request = async (
    method,
    pathname,
    { query, body, headers } = {},
  ) => {
    if (!auth.token) {
      throw new CloudflareApiError(
        "Missing Cloudflare API token. Run `agentic-devtools connect cloudflare`, or set CLOUDFLARE_API_TOKEN.",
      );
    }

    const url = new URL(pathname.replace(/^\//, ""), `${apiBaseUrl}/`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value == null || value === "") {
        continue;
      }
      url.searchParams.set(key, String(value));
    }

    const init = {
      method,
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
        ...compactObject(headers),
      },
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    const response = await fetchImpl(url, init);
    const payload = await response.json().catch(async () => response.text());

    if (!response.ok || !payload?.success) {
      throw new CloudflareApiError(
        formatCloudflareErrorMessage(payload, response.status),
        {
          status: response.status,
          errors: Array.isArray(payload?.errors) ? payload.errors : [],
          payload,
        },
      );
    }

    return payload;
  };

  const requireAccountId = (accountId, operation) => {
    const resolved = pickString(accountId, auth.defaultAccountId);
    if (resolved) {
      return resolved;
    }
    throw new CloudflareApiError(
      `${operation} requires a Cloudflare account id. Pass accountId, set CLOUDFLARE_ACCOUNT_ID, or save a default account id in Cloudflare auth config.`,
    );
  };

  const requireZoneId = (zoneId, operation) => {
    const resolved = pickString(zoneId, auth.defaultZoneId);
    if (resolved) {
      return resolved;
    }
    throw new CloudflareApiError(
      `${operation} requires a Cloudflare zone id. Pass zoneId, set CLOUDFLARE_ZONE_ID, or save a default zone id in Cloudflare auth config.`,
    );
  };

  const requireValue = (value, name, operation) => {
    const resolved = pickString(value);
    if (resolved) {
      return resolved;
    }
    throw new CloudflareApiError(`${operation} requires ${name}.`);
  };

  const requireObject = (value, name, operation) => {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      return value;
    }
    throw new CloudflareApiError(`${operation} requires ${name} to be an object.`);
  };

  const validateToken = async () => {
    const payload = await request("GET", "/user/tokens/verify");
    const result = payload.result ?? {};
    // The verify endpoint includes a status + token id. Scopes themselves are
    // not returned by /user/tokens/verify — to enumerate them, fetch the
    // token detail. For the new error model we want a single call that
    // returns { active, scopes } so the connect flow can probe.
    let scopes = [];
    if (result.id) {
      try {
        const detail = await request("GET", `/user/tokens/${result.id}`);
        const policies = Array.isArray(detail?.result?.policies)
          ? detail.result.policies
          : [];
        scopes = policies
          .flatMap((policy) =>
            Array.isArray(policy?.permission_groups)
              ? policy.permission_groups.map((g) => g?.id ?? g?.name)
              : [],
          )
          .filter(Boolean);
      } catch {
        // Token detail requires "User Details:Read" or self-token access.
        // If it fails, fall back to "active" without scope detail.
      }
    }
    return {
      ...result,
      active: result.status === "active" || result.status === "valid",
      scopes,
    };
  };

  /**
   * Mint an R2 S3-compatible access key by creating a Cloudflare API token
   * scoped to one bucket.
   *
   * Cloudflare wraps R2 S3 keys inside its generic API token system:
   *   accessKeyId      = token.id
   *   secretAccessKey  = sha256Hex(token.value)
   *
   * Requires "API Tokens:Write" on the calling token (declared in capabilities).
   */
  const createR2ApiToken = async ({
    bucketName,
    accountId,
    accountName,
    permission = "object-read-write",
    tokenName,
  } = {}) => {
    const operation = "createR2ApiToken";
    const resolvedBucketName = requireValue(bucketName, "bucketName", operation);
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation,
    });

    // Map friendly permission names → Cloudflare permission group names.
    // The resolver looks up current IDs from Cloudflare's live catalog at
    // call time (cached 24h), so we don't drift again like 0.1.9 did with
    // hardcoded IDs.
    const permissionSpecs = {
      "object-read-write": [
        { name: "Workers R2 Storage Bucket Item Write" },
      ],
      "object-read-only": [
        { name: "Workers R2 Storage Bucket Item Read" },
      ],
      "admin-read-write": [
        { name: "Workers R2 Storage Write" }, // account-scoped
      ],
    }[permission] ?? [{ name: "Workers R2 Storage Bucket Item Write" }];

    const resolvedGroups = await resolveCloudflarePermissionGroups(
      permissionSpecs,
      { authToken: auth.token, apiBaseUrl, fetchImpl },
    );
    const permissionGroups = resolvedGroups.map((g) => ({ id: g.id }));

    const body = {
      name: tokenName ?? `r2-${resolvedBucketName}-${Date.now()}`,
      policies: [
        {
          effect: "allow",
          permission_groups: permissionGroups,
          resources: {
            // Resource shape for an R2 bucket scope.
            [`com.cloudflare.edge.r2.bucket.${resolvedAccountId}_default_${resolvedBucketName}`]:
              "*",
          },
        },
      ],
    };

    const payload = await request("POST", "/user/tokens", { body });
    const token = payload.result ?? {};

    const accessKeyId = token.id;
    const rawValue = token.value;
    if (!accessKeyId || !rawValue) {
      throw new CloudflareApiError(
        "Cloudflare returned a token without id/value — cannot derive R2 S3 credentials.",
        { payload },
      );
    }

    const secretAccessKey = createHash("sha256")
      .update(rawValue)
      .digest("hex");

    return {
      accountId: resolvedAccountId,
      bucketName: resolvedBucketName,
      accessKeyId,
      secretAccessKey,
      endpoint: `https://${resolvedAccountId}.r2.cloudflarestorage.com`,
      tokenId: accessKeyId,
      tokenName: token.name,
      permission,
    };
  };

  const listAccounts = async ({
    name,
    page = 1,
    perPage = DEFAULT_PAGE_SIZE,
  } = {}) => {
    let apiAccounts = [];
    let resultInfo = null;
    let sawApiSuccess = false;

    try {
      const payload = await request("GET", "/accounts", {
        query: {
          name,
          page,
          per_page: clampPageSize(perPage),
        },
      });

      apiAccounts = payload.result ?? [];
      resultInfo = payload.result_info ?? null;
      sawApiSuccess = true;
    } catch (error) {
      if (!(error instanceof CloudflareApiError)) {
        throw error;
      }
    }

    const zonesResult = await listZones({ page: 1, perPage: 50 });
    const zoneAccounts = buildAccountsFromZones(zonesResult.zones);
    const accounts = uniqueAccounts([...apiAccounts, ...zoneAccounts]).filter((account) =>
      matchesSelector(account.name, name),
    );

    return {
      accounts,
      resultInfo:
        resultInfo ?? {
          page: 1,
          per_page: accounts.length,
          total_pages: 1,
          count: accounts.length,
          total_count: accounts.length,
        },
      source: sawApiSuccess
        ? zoneAccounts.length > 0
          ? "api+zones"
          : "api"
        : "zones",
    };
  };

  const listZones = async ({
    accountId,
    name,
    status: zoneStatus,
    page = 1,
    perPage = DEFAULT_PAGE_SIZE,
  } = {}) => {
    const payload = await request("GET", "/zones", {
      query: {
        ...(accountId ? { "account.id": accountId } : {}),
        name,
        status: zoneStatus,
        page,
        per_page: clampPageSize(perPage),
      },
    });
    return {
      zones: payload.result ?? [],
      resultInfo: payload.result_info ?? null,
    };
  };

  const getZone = async (zoneId) => {
    const id = requireZoneId(zoneId, "getCloudflareZone");
    const payload = await request("GET", `/zones/${id}`);
    return payload.result;
  };

  const resolveZoneId = async ({
    zoneId,
    zoneName,
    operation,
  } = {}) => {
    const explicitZoneId = pickString(zoneId);
    if (explicitZoneId) {
      return explicitZoneId;
    }

    if (pickString(auth.defaultZoneId)) {
      return auth.defaultZoneId;
    }

    const requestedZoneName = pickString(zoneName);
    const zonesResult = await listZones({
      ...(requestedZoneName ? { name: requestedZoneName } : {}),
      page: 1,
      perPage: 50,
    });

    const resolved = resolveSingleNamedResource({
      items: zonesResult.zones,
      requestedName: requestedZoneName,
      getId: (zone) => zone.id,
      getLabel: (zone) => zone.name,
      resourceLabel: "zone",
      operation,
    });

    if (resolved) {
      return resolved.id;
    }

    throw new CloudflareApiError(
      `${operation} requires a Cloudflare zone. Pass zoneId, pass zoneName, set CLOUDFLARE_ZONE_ID, or save a default zone id in Cloudflare auth config.`,
    );
  };

  const resolveAccountId = async ({
    accountId,
    accountName,
    operation,
  } = {}) => {
    const explicitAccountId = pickString(accountId);
    if (explicitAccountId) {
      return explicitAccountId;
    }

    if (pickString(auth.defaultAccountId)) {
      return auth.defaultAccountId;
    }

    const requestedAccountName = pickString(accountName);
    const accountsResult = await listAccounts({
      ...(requestedAccountName ? { name: requestedAccountName } : {}),
      page: 1,
      perPage: 50,
    });

    const resolved = resolveSingleNamedResource({
      items: accountsResult.accounts,
      requestedName: requestedAccountName,
      getId: (account) => account.id,
      getLabel: (account) => account.name,
      resourceLabel: "account",
      operation,
    });

    if (resolved) {
      return resolved.id;
    }

    throw new CloudflareApiError(
      `${operation} requires a Cloudflare account. Pass accountId, pass accountName, set CLOUDFLARE_ACCOUNT_ID, or save a default account id in Cloudflare auth config.`,
    );
  };

  const listTunnels = async ({
    accountId,
    accountName,
    name,
    isDeleted,
    page = 1,
    perPage = DEFAULT_PAGE_SIZE,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "listCloudflareTunnels",
    });
    const payload = await request("GET", `/accounts/${resolvedAccountId}/cfd_tunnel`, {
      query: {
        name,
        is_deleted:
          typeof isDeleted === "boolean" ? String(isDeleted) : undefined,
        page,
        per_page: clampPageSize(perPage),
      },
    });
    return {
      tunnels: payload.result ?? [],
      resultInfo: payload.result_info ?? null,
      accountId: resolvedAccountId,
    };
  };

  const resolveTunnelId = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
    operation,
  } = {}) => {
    const explicitTunnelId = pickString(tunnelId);
    if (explicitTunnelId) {
      return {
        accountId: await resolveAccountId({
          accountId,
          accountName,
          operation,
        }),
        tunnelId: explicitTunnelId,
      };
    }

    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation,
    });
    const requestedTunnelName = pickString(tunnelName);
    const tunnelsResult = await listTunnels({
      accountId: resolvedAccountId,
      ...(requestedTunnelName ? { name: requestedTunnelName } : {}),
      page: 1,
      perPage: 50,
    });
    const resolved = resolveSingleNamedResource({
      items: tunnelsResult.tunnels,
      requestedName: requestedTunnelName,
      getId: (tunnel) => tunnel.id,
      getLabel: (tunnel) => tunnel.name,
      resourceLabel: "tunnel",
      operation,
    });

    if (resolved) {
      return {
        accountId: resolvedAccountId,
        tunnelId: resolved.id,
      };
    }

    throw new CloudflareApiError(
      `${operation} requires a Cloudflare tunnel. Pass tunnelId or tunnelName.`,
    );
  };

  const listDnsRecords = async ({
    zoneId,
    zoneName,
    name,
    type,
    content,
    page = 1,
    perPage = DEFAULT_PAGE_SIZE,
  } = {}) => {
    const id = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "listCloudflareDnsRecords",
    });
    const payload = await request("GET", `/zones/${id}/dns_records`, {
      query: {
        name,
        type,
        content,
        page,
        per_page: clampPageSize(perPage),
      },
    });
    return {
      records: payload.result ?? [],
      resultInfo: payload.result_info ?? null,
    };
  };

  const getDnsRecord = async ({ zoneId, zoneName, recordId } = {}) => {
    const resolvedZoneId = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "getCloudflareDnsRecord",
    });
    const resolvedRecordId = requireValue(
      recordId,
      "recordId",
      "getCloudflareDnsRecord",
    );
    const payload = await request(
      "GET",
      `/zones/${resolvedZoneId}/dns_records/${resolvedRecordId}`,
    );
    return payload.result;
  };

  const createDnsRecord = async ({ zoneId, zoneName, ...record } = {}) => {
    const resolvedZoneId = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "createCloudflareDnsRecord",
    });
    const payload = await request("POST", `/zones/${resolvedZoneId}/dns_records`, {
      body: compactObject(record),
    });
    return payload.result;
  };

  const updateDnsRecord = async ({
    zoneId,
    zoneName,
    recordId,
    ...record
  } = {}) => {
    const resolvedZoneId = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "updateCloudflareDnsRecord",
    });
    const resolvedRecordId = requireValue(
      recordId,
      "recordId",
      "updateCloudflareDnsRecord",
    );
    const payload = await request(
      "PATCH",
      `/zones/${resolvedZoneId}/dns_records/${resolvedRecordId}`,
      {
        body: compactObject(record),
      },
    );
    return payload.result;
  };

  const deleteDnsRecord = async ({ zoneId, zoneName, recordId } = {}) => {
    const resolvedZoneId = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "deleteCloudflareDnsRecord",
    });
    const resolvedRecordId = requireValue(
      recordId,
      "recordId",
      "deleteCloudflareDnsRecord",
    );
    const payload = await request(
      "DELETE",
      `/zones/${resolvedZoneId}/dns_records/${resolvedRecordId}`,
    );
    return {
      deleted: Boolean(payload.result?.id),
      recordId: payload.result?.id ?? resolvedRecordId,
      zoneId: resolvedZoneId,
    };
  };

  const getTunnel = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "getCloudflareTunnel",
    });
    const payload = await request(
      "GET",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}`,
    );
    return payload.result;
  };

  const createTunnel = async ({
    accountId,
    accountName,
    name,
    configSource = "cloudflare",
    tunnelSecret,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "createCloudflareTunnel",
    });
    const resolvedName = requireValue(name, "name", "createCloudflareTunnel");
    const resolvedConfigSource = normalizeTunnelConfigSource(configSource);

    if (resolvedConfigSource === "local" && !pickString(tunnelSecret)) {
      throw new CloudflareApiError(
        "createCloudflareTunnel requires tunnelSecret when configSource is local.",
      );
    }

    const payload = await request(
      "POST",
      `/accounts/${resolvedAccountId}/cfd_tunnel`,
      {
        body: compactObject({
          name: resolvedName,
          config_src: resolvedConfigSource,
          tunnel_secret: pickString(tunnelSecret) ?? undefined,
        }),
      },
    );
    return payload.result;
  };

  const updateTunnel = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
    name,
    tunnelSecret,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "updateCloudflareTunnel",
    });
    const payload = await request(
      "PATCH",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}`,
      {
        body: compactObject({
          name: pickString(name) ?? undefined,
          tunnel_secret: pickString(tunnelSecret) ?? undefined,
        }),
      },
    );
    return payload.result;
  };

  const deleteTunnel = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "deleteCloudflareTunnel",
    });
    await request(
      "DELETE",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}`,
    );
    return {
      deleted: true,
      accountId: resolved.accountId,
      tunnelId: resolved.tunnelId,
    };
  };

  const getTunnelToken = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "getCloudflareTunnelToken",
    });
    const payload = await request(
      "GET",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}/token`,
    );
    return {
      accountId: resolved.accountId,
      tunnelId: resolved.tunnelId,
      token: payload.result,
    };
  };

  const getTunnelConfiguration = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "getCloudflareTunnelConfiguration",
    });
    const payload = await request(
      "GET",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}/configurations`,
    );
    return payload.result;
  };

  const updateTunnelConfiguration = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
    config,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "updateCloudflareTunnelConfiguration",
    });
    const resolvedConfig = requireObject(
      config,
      "config",
      "updateCloudflareTunnelConfiguration",
    );
    const payload = await request(
      "PUT",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}/configurations`,
      {
        body: {
          config: resolvedConfig,
        },
      },
    );
    return payload.result;
  };

  const listTunnelConnections = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "listCloudflareTunnelConnections",
    });
    const payload = await request(
      "GET",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}/connections`,
    );
    return {
      accountId: resolved.accountId,
      tunnelId: resolved.tunnelId,
      connections: payload.result ?? [],
    };
  };

  const cleanupTunnelConnections = async ({
    accountId,
    accountName,
    tunnelId,
    tunnelName,
    clientId,
  } = {}) => {
    const resolved = await resolveTunnelId({
      accountId,
      accountName,
      tunnelId,
      tunnelName,
      operation: "cleanupCloudflareTunnelConnections",
    });
    await request(
      "DELETE",
      `/accounts/${resolved.accountId}/cfd_tunnel/${resolved.tunnelId}/connections`,
      {
        query: {
          client_id: pickString(clientId) ?? undefined,
        },
      },
    );
    return {
      cleanedUp: true,
      accountId: resolved.accountId,
      tunnelId: resolved.tunnelId,
      clientId: pickString(clientId) ?? null,
    };
  };

  const listR2Buckets = async ({
    accountId,
    accountName,
    jurisdiction,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "listCloudflareR2Buckets",
    });
    const payload = await request("GET", `/accounts/${resolvedAccountId}/r2/buckets`, {
      headers: jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined,
    });
    return payload.result?.buckets ?? payload.result ?? [];
  };

  const getR2Bucket = async ({
    accountId,
    accountName,
    bucketName,
    jurisdiction,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "getCloudflareR2Bucket",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "getCloudflareR2Bucket",
    );
    const payload = await request(
      "GET",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}`,
      {
        headers: jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined,
      },
    );
    return payload.result;
  };

  const createR2Bucket = async ({
    accountId,
    accountName,
    bucketName,
    locationHint,
    storageClass,
    jurisdiction,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "createCloudflareR2Bucket",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "createCloudflareR2Bucket",
    );
    const payload = await request("POST", `/accounts/${resolvedAccountId}/r2/buckets`, {
      headers: jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined,
      body: compactObject({
        name: resolvedBucketName,
        locationHint,
        storageClass,
      }),
    });
    return payload.result;
  };

  const updateR2Bucket = async ({
    accountId,
    accountName,
    bucketName,
    storageClass,
    jurisdiction,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "updateCloudflareR2Bucket",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "updateCloudflareR2Bucket",
    );
    const payload = await request(
      "PATCH",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}`,
      {
        headers: compactObject({
          "cf-r2-storage-class": storageClass,
          "cf-r2-jurisdiction": jurisdiction,
        }),
      },
    );
    return payload.result;
  };

  const deleteR2Bucket = async ({
    accountId,
    accountName,
    bucketName,
    jurisdiction,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "deleteCloudflareR2Bucket",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "deleteCloudflareR2Bucket",
    );
    await request(
      "DELETE",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}`,
      {
        headers: jurisdiction ? { "cf-r2-jurisdiction": jurisdiction } : undefined,
      },
    );
    return {
      deleted: true,
      bucketName: resolvedBucketName,
      accountId: resolvedAccountId,
      jurisdiction: jurisdiction ?? null,
    };
  };

  const getR2ManagedDomain = async ({
    accountId,
    accountName,
    bucketName,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "getCloudflareR2ManagedDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "getCloudflareR2ManagedDomain",
    );
    const payload = await request(
      "GET",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/managed`,
    );
    return payload.result;
  };

  const updateR2ManagedDomain = async ({
    accountId,
    accountName,
    bucketName,
    enabled,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "updateCloudflareR2ManagedDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "updateCloudflareR2ManagedDomain",
    );
    const payload = await request(
      "PUT",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/managed`,
      {
        body: compactObject({ enabled }),
      },
    );
    return payload.result;
  };

  const listR2CustomDomains = async ({
    accountId,
    accountName,
    bucketName,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "listCloudflareR2CustomDomains",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "listCloudflareR2CustomDomains",
    );
    const payload = await request(
      "GET",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/custom`,
    );
    return payload.result?.domains ?? payload.result ?? [];
  };

  const getR2CustomDomain = async ({
    accountId,
    accountName,
    bucketName,
    domain,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "getCloudflareR2CustomDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "getCloudflareR2CustomDomain",
    );
    const resolvedDomain = requireValue(
      domain,
      "domain",
      "getCloudflareR2CustomDomain",
    );
    const payload = await request(
      "GET",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/custom/${encodeURIComponent(resolvedDomain)}`,
    );
    return payload.result;
  };

  const createR2CustomDomain = async ({
    accountId,
    accountName,
    bucketName,
    domain,
    zoneId,
    zoneName,
    enabled,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "createCloudflareR2CustomDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "createCloudflareR2CustomDomain",
    );
    const resolvedDomain = requireValue(
      domain,
      "domain",
      "createCloudflareR2CustomDomain",
    );
    const resolvedZoneId = await resolveZoneId({
      zoneId,
      zoneName,
      operation: "createCloudflareR2CustomDomain",
    });
    const payload = await request(
      "POST",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/custom`,
      {
        body: compactObject({
          domain: resolvedDomain,
          zoneId: resolvedZoneId,
          enabled,
        }),
      },
    );
    return payload.result;
  };

  const updateR2CustomDomain = async ({
    accountId,
    accountName,
    bucketName,
    domain,
    enabled,
    minTls,
    zoneId,
    zoneName,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "updateCloudflareR2CustomDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "updateCloudflareR2CustomDomain",
    );
    const resolvedDomain = requireValue(
      domain,
      "domain",
      "updateCloudflareR2CustomDomain",
    );
    const payload = await request(
      "PUT",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/custom/${encodeURIComponent(resolvedDomain)}`,
      {
        body: compactObject({
          enabled,
          minTLS: minTls,
          zoneId:
            zoneId || zoneName
              ? await resolveZoneId({
                  zoneId,
                  zoneName,
                  operation: "updateCloudflareR2CustomDomain",
                })
              : undefined,
        }),
      },
    );
    return payload.result;
  };

  const deleteR2CustomDomain = async ({
    accountId,
    accountName,
    bucketName,
    domain,
  } = {}) => {
    const resolvedAccountId = await resolveAccountId({
      accountId,
      accountName,
      operation: "deleteCloudflareR2CustomDomain",
    });
    const resolvedBucketName = requireValue(
      bucketName,
      "bucketName",
      "deleteCloudflareR2CustomDomain",
    );
    const resolvedDomain = requireValue(
      domain,
      "domain",
      "deleteCloudflareR2CustomDomain",
    );
    await request(
      "DELETE",
      `/accounts/${resolvedAccountId}/r2/buckets/${resolvedBucketName}/domains/custom/${encodeURIComponent(resolvedDomain)}`,
    );
    return {
      deleted: true,
      accountId: resolvedAccountId,
      bucketName: resolvedBucketName,
      domain: resolvedDomain,
    };
  };

  return {
    auth,
    apiBaseUrl,
    getAuthStatus: () => getCloudflareAuthStatus(env),
    validateToken,
    listAccounts,
    listZones,
    getZone,
    listTunnels,
    getTunnel,
    createTunnel,
    updateTunnel,
    deleteTunnel,
    getTunnelToken,
    getTunnelConfiguration,
    updateTunnelConfiguration,
    listTunnelConnections,
    cleanupTunnelConnections,
    listDnsRecords,
    getDnsRecord,
    createDnsRecord,
    updateDnsRecord,
    deleteDnsRecord,
    listR2Buckets,
    getR2Bucket,
    createR2Bucket,
    updateR2Bucket,
    deleteR2Bucket,
    getR2ManagedDomain,
    updateR2ManagedDomain,
    listR2CustomDomains,
    getR2CustomDomain,
    createR2CustomDomain,
    updateR2CustomDomain,
    deleteR2CustomDomain,
    createR2ApiToken,
  };
};

const clampPageSize = (value) => {
  const parsed = Number.parseInt(String(value ?? DEFAULT_PAGE_SIZE), 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(parsed, 1), MAX_PAGE_SIZE);
};

const compactObject = (value) =>
  Object.fromEntries(
    Object.entries(value ?? {}).filter(([, entry]) => entry !== undefined),
  );

const pickString = (...values) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
};

const formatCloudflareErrorMessage = (payload, status) => {
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  const message = errors
    .map((entry) => entry?.message?.trim())
    .filter(Boolean)
    .join(" | ");

  if (message) {
    return message;
  }

  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload.trim();
  }

  return `Cloudflare API request failed with HTTP ${status}`;
};

const buildAccountsFromZones = (zones) =>
  uniqueAccounts(
    (Array.isArray(zones) ? zones : [])
      .filter((zone) => zone?.account?.id && zone?.account?.name)
      .map((zone) => ({
        id: zone.account.id,
        name: zone.account.name,
      })),
  );

const uniqueAccounts = (accounts) =>
  [...new Map(
    (accounts ?? [])
      .filter((account) => account?.id && account?.name)
      .map((account) => [account.id, account]),
  ).values()];

const normalizeTunnelConfigSource = (value) => {
  const normalized = pickString(value)?.toLowerCase();
  if (!normalized) {
    return "cloudflare";
  }

  if (normalized === "cloudflare" || normalized === "local") {
    return normalized;
  }

  throw new CloudflareApiError(
    `Cloudflare tunnel configSource must be "cloudflare" or "local". Received "${value}".`,
  );
};

// `resolveSingleNamedResource`, `matchesSelector`, and `normalizeSelector`
// were lifted to `src/core/resolve-resource.mjs` and are imported at the top
// of this file.

// =============================================================================
// Bootstrap client — used only at project-init time
// =============================================================================
//
// The bootstrap client uses a global user-level token whose only purpose is to
// mint account-scoped working tokens via `POST /user/tokens`. It is NOT used
// for day-to-day ops (DNS, R2 CRUD, etc.) — those use the working token in the
// per-project credential store.
//
// Workflow:
//   1. User runs `bun zero connect cloudflare` once per machine. Browser-based
//      auth flow asks them to create a bootstrap via the "Create Additional
//      Tokens" template (one-click in Cloudflare's dashboard).
//   2. Bootstrap saved to ~/.config/agentic-devtools/cloudflare-bootstrap.json.
//   3. When initialising a new project, the bootstrap client is used to:
//        a. List accessible accounts (via /accounts).
//        b. Ask user which account this project is for.
//        c. Mint an account-scoped working token via mintWorkingToken().
//        d. Working token is written to the project's credential store.
//   4. After that, only the working token is used.

/**
 * Default permission groups for a Zeroframe working token. Specified by
 * NAME (and scope where ambiguous) — the resolver fetches current Cloudflare
 * IDs at runtime. This protects against Cloudflare rotating IDs
 * (which happened between our 0.1.9 → 0.1.10 ship — see commit history).
 *
 * The fallback IDs live in `core/permission-group-resolver.mjs` for the
 * offline case.
 */
export const DEFAULT_WORKING_TOKEN_PERMISSION_SPECS = Object.freeze([
  // R2 buckets: write
  { name: "Workers R2 Storage Write" },
  // Workers Scripts: write
  { name: "Workers Scripts Write" },
  // DNS: write (zone-scoped)
  { name: "DNS Write" },
  // Zone: read (zone-scoped, needed for domain lookups)
  { name: "Zone Read" },
  // API Tokens: write (user-scoped — needed for per-bucket R2 key minting)
  { name: "API Tokens Write", scope: "com.cloudflare.api.user" },
]);

export const createCloudflareBootstrapClient = ({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) => {
  const bootstrap = getCloudflareBootstrapToken(env);
  const apiBaseUrl =
    (env.CLOUDFLARE_API_BASE_URL ?? DEFAULT_CLOUDFLARE_API_BASE_URL).replace(
      /\/+$/,
      "",
    );

  if (typeof fetchImpl !== "function") {
    throw new Error("Cloudflare bootstrap client requires a fetch implementation.");
  }

  const request = async (method, pathname, { body } = {}) => {
    if (!bootstrap.token) {
      throw new CloudflareApiError(
        "Missing Cloudflare bootstrap token. Run `bun zero connect cloudflare` once per machine to create one.",
      );
    }
    const url = new URL(pathname.replace(/^\//, ""), `${apiBaseUrl}/`);
    const init = {
      method,
      headers: {
        Authorization: `Bearer ${bootstrap.token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetchImpl(url, init);
    const payload = await response.json().catch(async () => response.text());
    if (!response.ok || !payload?.success) {
      throw new CloudflareApiError(
        formatCloudflareErrorMessage(payload, response.status),
        {
          status: response.status,
          errors: Array.isArray(payload?.errors) ? payload.errors : [],
          payload,
        },
      );
    }
    return payload;
  };

  /**
   * Verify the bootstrap token is alive and probe its scopes.
   */
  const validate = async () => {
    const payload = await request("GET", "/user/tokens/verify");
    const result = payload.result ?? {};
    return {
      ...result,
      active: result.status === "active" || result.status === "valid",
      source: bootstrap.source,
    };
  };

  /**
   * List the accounts this bootstrap token has any visibility into. Used by
   * the connect flow to ask the user which account a project is for.
   */
  const listAccessibleAccounts = async () => {
    const payload = await request("GET", "/accounts");
    return {
      accounts: payload.result ?? [],
      resultInfo: payload.result_info ?? null,
    };
  };

  /**
   * Mint a long-lived account-scoped working token. Returns the raw token
   * value — the CALLER must store it securely (typically in
   * <project>/.zeroframe/credentials/cloudflare.json) and discard the raw
   * value from memory.
   *
   * The minted token's scopes are the supplied permission groups, locked to
   * the supplied account via the resources field. If no permission groups are
   * given, the Zeroframe defaults are used (R2 + Workers + DNS + Zone +
   * API Tokens, all account-scoped).
   */
  const mintWorkingToken = async ({
    accountId,
    accountName,
    permissionGroups,
    permissionSpecs,
    tokenName,
  } = {}) => {
    if (!accountId) {
      throw new CloudflareApiError(
        "mintWorkingToken requires accountId. Call listAccessibleAccounts first to discover available accounts.",
      );
    }

    // Three input modes, in priority order:
    //   1. Caller passes resolved permissionGroups (raw IDs) → use as-is
    //   2. Caller passes permissionSpecs (names) → resolve via API now
    //   3. Default: resolve DEFAULT_WORKING_TOKEN_PERMISSION_SPECS
    let groups;
    if (Array.isArray(permissionGroups) && permissionGroups.length > 0) {
      groups = permissionGroups;
    } else {
      const specs =
        Array.isArray(permissionSpecs) && permissionSpecs.length > 0
          ? permissionSpecs
          : [...DEFAULT_WORKING_TOKEN_PERMISSION_SPECS];
      const resolved = await resolveCloudflarePermissionGroups(specs, {
        authToken: bootstrap.token,
        apiBaseUrl,
        fetchImpl,
      });
      groups = resolved.map((g) => ({ id: g.id }));
    }

    const name =
      tokenName ??
      `zero-frame-${(accountName ?? accountId).slice(0, 24)}-${Date.now()}`;

    const body = {
      name,
      policies: [
        {
          effect: "allow",
          permission_groups: groups,
          resources: {
            [`com.cloudflare.api.account.${accountId}`]: "*",
          },
        },
      ],
    };

    const payload = await request("POST", "/user/tokens", { body });
    const token = payload.result ?? {};
    if (!token.value || !token.id) {
      throw new CloudflareApiError(
        "Cloudflare did not return id+value for the new token.",
        { payload },
      );
    }

    return {
      tokenId: token.id,
      tokenValue: token.value,
      tokenName: token.name,
      accountId,
      accountName,
      permission_group_ids: groups.map((g) => g.id),
    };
  };

  return {
    bootstrap,
    apiBaseUrl,
    validate,
    listAccessibleAccounts,
    mintWorkingToken,
  };
};
