/**
 * Declarative capability + scope requirements per provider.
 *
 * This is read by:
 *   - the connect flow (display the required scopes + dashboard link)
 *   - the validateToken upgrade (probe each scope against the actual token)
 *   - `bun zero doctor` (future — cross-check connections against required scopes)
 *
 * Keep this flat. We are NOT building an exhaustive per-operation capability
 * matrix; we're declaring what Zero Frame's actual flows need. New scopes only
 * land here when a new flow needs them.
 *
 * The `id` field uses Cloudflare's permission-group identifier where possible
 * (the strings Cloudflare returns in /user/tokens/verify scopes). For
 * providers without machine-readable scopes (Railway), `id` is a stable
 * lowercase token we coin and use for messaging.
 */

export const CAPABILITIES = Object.freeze({
  cloudflare: {
    scopes: [
      {
        id: "com.cloudflare.api.account.r2.bucket.edit",
        display: "Account · R2 Storage (Edit)",
        needed_for: [
          "create / delete R2 buckets",
          "mint R2 S3 access keys",
        ],
      },
      {
        id: "com.cloudflare.api.user.api_tokens.write",
        display: "Account · API Tokens (Write)",
        needed_for: [
          "mint R2 S3 access keys (Cloudflare wraps S3 keys as API tokens)",
        ],
      },
      {
        id: "com.cloudflare.api.account.worker.edit",
        display: "Account · Workers Scripts (Edit)",
        needed_for: ["deploy / update Workers"],
      },
      {
        id: "com.cloudflare.api.account.zone.dns.edit",
        display: "Zone · DNS (Edit)",
        needed_for: ["add / remove DNS records for custom domains"],
      },
      {
        id: "com.cloudflare.api.account.zone.zone.read",
        display: "Zone · Zone (Read)",
        needed_for: ["domain lookup, custom-domain checks"],
      },
    ],
    dashboard_token_url: "https://dash.cloudflare.com/profile/api-tokens",
    bootstrap_note:
      "Cloudflare requires the first 'API Tokens:Write' token to be created via dashboard (the 'Create Additional Tokens' template). This is a one-time security requirement; after that, all R2 operations are programmatic.",
  },

  railway: {
    scopes: [
      {
        id: "railway.account.full",
        display: "Account-level token (Full Access)",
        needed_for: [
          "create / destroy projects",
          "manage environments + variables",
          "deploy from GitHub",
        ],
      },
      // Railway also supports project-level tokens for finer-grained access.
      // Those are detected separately by token-context probing — not declared
      // as a required scope here.
    ],
    dashboard_token_url: "https://railway.com/account/tokens",
    bootstrap_note:
      "Railway tokens come in two flavours: account tokens (broad — used for most ops) and project tokens (scoped to one project). Zero Frame uses an account token at connect time and creates project tokens as needed.",
  },

  namecheap: {
    scopes: [
      {
        id: "namecheap.api.access",
        display: "API Access (whitelisted IP + API key)",
        needed_for: ["domain availability + DNS management"],
      },
    ],
    dashboard_token_url:
      "https://ap.www.namecheap.com/Profile/Tools/ApiAccess",
    bootstrap_note:
      "Namecheap requires both an API key AND an IP allowlist entry. You need to register your machine's outbound IP from the dashboard before any API calls will work.",
  },

  npm: {
    scopes: [
      {
        id: "npm.publish",
        display: "npm publish (automation token, 2FA-bypass)",
        needed_for: ["publish packages from this machine"],
      },
    ],
    dashboard_token_url: "https://www.npmjs.com/settings/~/tokens",
    bootstrap_note:
      "Use an 'Automation' token type. Granular tokens with publish + package-read scopes also work. Personal access tokens with 2FA enforcement will block CI-style publishes.",
  },
});

/**
 * Convenience: get the capability declaration for a provider, or undefined.
 */
export const capabilitiesFor = (provider) => CAPABILITIES[provider];

/**
 * Given a list of scope IDs the token actually has (as reported by the
 * provider's verify endpoint), return { granted, missing } against the
 * declared required scopes.
 */
export const probeScopes = (provider, tokenScopeIds = []) => {
  const cap = capabilitiesFor(provider);
  if (!cap) {
    return { granted: [], missing: [], unknown_provider: true };
  }

  const has = new Set(tokenScopeIds.map((s) => String(s).toLowerCase()));
  const granted = [];
  const missing = [];

  for (const scope of cap.scopes) {
    const key = String(scope.id).toLowerCase();
    // Some providers return the display label rather than the id. Match
    // either form to be tolerant.
    const displayKey = String(scope.display).toLowerCase();
    if (has.has(key) || has.has(displayKey)) {
      granted.push(scope);
    } else {
      // Fuzzy: match by partial-substring on the lowercased id. Useful for
      // providers that return scopes in slightly different naming.
      const fuzzy = [...has].some(
        (h) => key.includes(h) || h.includes(key) || displayKey.includes(h),
      );
      if (fuzzy) {
        granted.push(scope);
      } else {
        missing.push(scope);
      }
    }
  }

  return { granted, missing };
};
