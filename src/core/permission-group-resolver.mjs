/**
 * Cloudflare permission-group ID resolver.
 *
 * Cloudflare rotates permission group IDs occasionally — our v0.1.9 ship
 * surfaced exactly this drift: `User: API Tokens (Edit)` ID changed and our
 * hardcoded `0aeacf61d2da4e168ec97f8efacf9b4f` broke `mint-working`.
 *
 * This resolver looks up current IDs at runtime via
 * `GET /user/tokens/permission_groups`, caches for 24h, and falls back to a
 * pinned-but-occasionally-updated set if the API is unreachable.
 *
 * The fallback table is verified against live Cloudflare on every minor
 * release (see scripts/refresh-permission-groups.mjs).
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const DEFAULT_CLOUDFLARE_API_BASE_URL =
  "https://api.cloudflare.com/client/v4";

// Single shared cache. Cloudflare's catalog is account-independent, so we
// don't key by token.
const cache = {
  groups: null, // array<{id, name, scopes}>
  fetchedAt: 0,
  promise: null, // dedupe concurrent refresh
};

// Fallback IDs — verified against Cloudflare's live catalog on
// 2026-05-22. If the runtime lookup fails (network, auth, etc.), these are
// the last-known-good IDs we ship with.
//
// To refresh: run `node scripts/refresh-permission-groups.mjs` against a
// bootstrap-shape token; it audits the table and prints replacements for any
// that have rotated.
export const CLOUDFLARE_PERMISSION_GROUP_FALLBACKS = Object.freeze({
  "Workers R2 Storage Bucket Item Write": {
    id: "2efd5506f9c8494dacb1fa10a3e7d5b6",
    scope: "com.cloudflare.edge.r2.bucket",
  },
  "Workers R2 Storage Bucket Item Read": {
    id: "6a018a9f2fc74eb6b293b0c548f38b39",
    scope: "com.cloudflare.edge.r2.bucket",
  },
  "Workers R2 Storage Write": {
    id: "bf7481a1826f439697cb59a20b22293e",
    scope: "com.cloudflare.api.account",
  },
  "Workers R2 Storage Read": {
    id: "b4992e1108244f5d8bfbd5744320c2e1",
    scope: "com.cloudflare.api.account",
  },
  "Workers Scripts Write": {
    id: "e086da7e2179491d91ee5f35b3ca210a",
    scope: "com.cloudflare.api.account",
  },
  "DNS Write": {
    id: "4755a26eedb94da69e1066d98aa820be",
    scope: "com.cloudflare.api.account.zone",
  },
  "Zone Read": {
    id: "c8fed203ed3043cba015a93ad1616f1f",
    scope: "com.cloudflare.api.account.zone",
  },
  // The one that drifted between 0.1.9 and 0.1.10. User-scoped.
  "API Tokens Write": {
    id: "686d18d5ac6c441c867cbf6771e58a0a",
    scope: "com.cloudflare.api.user",
  },
  "API Tokens Read": {
    id: "0cc3a61731504c89b99ec1be78b77aa0",
    scope: "com.cloudflare.api.user",
  },
});

const fetchCatalog = async ({ apiBaseUrl, authToken, fetchImpl }) => {
  const url = new URL(
    "user/tokens/permission_groups?per_page=200",
    `${apiBaseUrl.replace(/\/+$/, "")}/`,
  );
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${authToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Cloudflare permission-groups fetch failed: HTTP ${response.status}`,
    );
  }
  const payload = await response.json();
  if (!payload?.success || !Array.isArray(payload.result)) {
    throw new Error(
      `Cloudflare permission-groups response not successful: ${JSON.stringify(payload?.errors ?? "no errors field")}`,
    );
  }
  return payload.result;
};

/**
 * Get the full permission-group catalog. Lazy-fetches + caches 24h.
 * Concurrent calls share one fetch. Errors trigger fallback to bundled table.
 */
export const getCloudflarePermissionGroups = async ({
  authToken,
  apiBaseUrl = DEFAULT_CLOUDFLARE_API_BASE_URL,
  fetchImpl = globalThis.fetch,
  now = Date.now,
} = {}) => {
  const isFresh =
    cache.groups && now() - cache.fetchedAt < CACHE_TTL_MS;
  if (isFresh) return cache.groups;

  if (cache.promise) return cache.promise;
  if (!authToken) {
    // No token + no cache → use fallback. Caller will see fallback shape.
    return materialiseFallback();
  }

  cache.promise = fetchCatalog({ apiBaseUrl, authToken, fetchImpl })
    .then((groups) => {
      cache.groups = groups;
      cache.fetchedAt = now();
      cache.promise = null;
      return groups;
    })
    .catch((err) => {
      cache.promise = null;
      // Don't poison cache; let next call retry.
      throw err;
    });

  return cache.promise;
};

const materialiseFallback = () => {
  return Object.entries(CLOUDFLARE_PERMISSION_GROUP_FALLBACKS).map(
    ([name, { id, scope }]) => ({ id, name, scopes: [scope] }),
  );
};

/**
 * Resolve one permission group by name (and optional scope filter) to its
 * current ID. Hits the API via getCloudflarePermissionGroups; on failure,
 * falls back to the bundled table.
 *
 * Returns `{ id, name, scopes }` matching Cloudflare's response shape. Throws
 * if the name doesn't resolve in either source.
 */
export const resolveCloudflarePermissionGroup = async ({
  name,
  scope,
  authToken,
  apiBaseUrl,
  fetchImpl,
  now,
} = {}) => {
  if (!name) {
    throw new Error("resolveCloudflarePermissionGroup requires name.");
  }

  let groups;
  try {
    groups = await getCloudflarePermissionGroups({
      authToken,
      apiBaseUrl,
      fetchImpl,
      now,
    });
  } catch {
    groups = materialiseFallback();
  }

  const lowerName = name.toLowerCase();
  const candidates = groups.filter(
    (g) => String(g.name ?? "").toLowerCase() === lowerName,
  );

  if (candidates.length === 0) {
    // Try bundled fallback explicitly — the catalog may have moved.
    if (CLOUDFLARE_PERMISSION_GROUP_FALLBACKS[name]) {
      const fb = CLOUDFLARE_PERMISSION_GROUP_FALLBACKS[name];
      return { id: fb.id, name, scopes: [fb.scope] };
    }
    throw new Error(
      `Permission group "${name}" not found in Cloudflare catalog. Run 'agentic-devtools list-permission-groups cloudflare' to inspect.`,
    );
  }

  if (candidates.length === 1) return candidates[0];

  // Multiple matches (e.g. R2 Storage is both account-level and bucket-item).
  // Filter by scope if supplied.
  if (scope) {
    const scoped = candidates.filter((g) =>
      (g.scopes ?? []).some((s) => s === scope || s.includes(scope)),
    );
    if (scoped.length === 1) return scoped[0];
    if (scoped.length === 0) {
      throw new Error(
        `Permission group "${name}" has no match with scope "${scope}". Got: ${candidates.map((c) => c.scopes?.[0]).join(", ")}.`,
      );
    }
    throw new Error(
      `Permission group "${name}" + scope "${scope}" ambiguous: ${scoped.length} matches.`,
    );
  }

  throw new Error(
    `Permission group "${name}" ambiguous (${candidates.length} matches). Specify scope.`,
  );
};

/**
 * Batch-resolve a list of {name, scope} specs → array of
 * `{ id, name, scopes }`. Used by mintWorkingToken to build the policies
 * field with current IDs.
 */
export const resolveCloudflarePermissionGroups = async (
  specs,
  { authToken, apiBaseUrl, fetchImpl, now } = {},
) => {
  const results = [];
  for (const spec of specs) {
    // eslint-disable-next-line no-await-in-loop -- serialise to share cache
    const group = await resolveCloudflarePermissionGroup({
      ...spec,
      authToken,
      apiBaseUrl,
      fetchImpl,
      now,
    });
    results.push(group);
  }
  return results;
};

/**
 * For tests + maintenance: clear the in-memory cache.
 */
export const __clearPermissionGroupCache = () => {
  cache.groups = null;
  cache.fetchedAt = 0;
  cache.promise = null;
};
