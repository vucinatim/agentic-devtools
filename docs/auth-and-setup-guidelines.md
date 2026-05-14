# Auth And Setup Guidelines

Agentic Devtools should make account setup as low-friction as each provider
honestly allows.

The ideal user experience is:

```bash
npx -y @vucinatim/agentic-devtools connect <tool>
```

After that, MCP host config should not need tokens inline:

```json
{
  "mcpServers": {
    "railway": {
      "command": "npx",
      "args": ["-y", "@vucinatim/agentic-devtools", "mcp", "railway"]
    }
  }
}
```

The local MCP server should resolve stored credentials automatically.

## Core Setup Commands

Every tool should eventually support the same setup command shape:

```bash
agentic-devtools connect <tool>
agentic-devtools disconnect <tool>
agentic-devtools auth-status <tool>
agentic-devtools test-connection <tool>
```

Shared CLI behavior belongs in `src/cli.mjs` and shared helpers under
`src/core/`.

Provider-specific auth details belong inside each tool:

```txt
src/tools/<tool>/auth.mjs
src/tools/<tool>/client.mjs
```

Do not make host adapters own auth logic.

## Credential Storage

Store credentials outside project folders by default:

```txt
~/.config/agentic-devtools/
  railway.json
  namecheap.json
```

Rules:

- never store credentials in the consuming project
- never require MCP host config to contain secrets after `connect`
- allow environment variables for stateless CI/server setups
- environment variables should override stored local credentials
- `disconnect <tool>` should remove local stored credentials for that tool
- auth status commands must never print token values

## Provider Auth Tiers

Not every service can support one-click setup. Each tool should document its
friction level honestly.

### Tier 1: OAuth / One-Click

Best case:

1. user runs `connect <tool>`
2. browser opens provider OAuth
3. user approves access
4. local callback captures auth code
5. package exchanges code with PKCE
6. token is stored locally
7. `mcp <tool>` works without extra host config

Use this when the provider supports OAuth for user-delegated access.

### Tier 2: Guided Token Setup

Use when provider supports API tokens but not first-class OAuth.

Flow:

1. user runs `connect <tool>`
2. browser opens a local setup page
3. page links directly to the provider token screen
4. user creates/pastes token
5. package validates token
6. package stores token locally

This is not true one-click, but it can still feel guided and low-friction.

### Tier 3: Guided Manual Setup

Use when provider requires extra account-side configuration, such as IP
allowlisting.

Flow:

1. user runs `connect <tool>`
2. browser opens a local setup page
3. page explains exact provider steps
4. page detects and displays needed local facts when possible
5. user performs provider-side setup
6. user pastes credentials
7. package validates credentials
8. package stores credentials locally

This is the lowest honest friction for providers that require manual controls.

## Railway

Railway should aim for Tier 1 eventually.

Railway supports the public API through tokens, and Railway docs describe
“Login with Railway” OAuth for apps acting on behalf of users.

Recommended path:

1. implement `connect railway` with guided token setup first
2. store token in `~/.config/agentic-devtools/railway.json`
3. support:
   - `RAILWAY_PROJECT_TOKEN`
   - `RAILWAY_API_TOKEN`
   - `RAILWAY_TOKEN`
   - `RAILWAY_PROJECT_ID`
4. make env vars override stored config
5. add OAuth once the app registration and callback flow are ready

Token guidance:

- project token: narrow project-scoped inspection
- account/workspace token: account identity and project listing
- do not ask for account token when a project token is enough

## Namecheap

Namecheap is Tier 3.

Namecheap API access requires:

- API access enabled in the account
- API user
- API key
- username
- client IPv4
- whitelisted IPv4 address

The setup flow should therefore be guided:

1. `connect namecheap`
2. open local browser setup page
3. display current public IPv4 if it can be detected
4. link to Namecheap API access page
5. explain IP whitelist requirement
6. accept API credentials
7. validate with a lightweight API call
8. store credentials in `~/.config/agentic-devtools/namecheap.json`

Do not describe Namecheap as one-click unless we later build a hosted connector
with a stable egress IP and explicit security model.

## npm

npm is Tier 2 for local tools and Tier 1 for CI publishing.

For local MCP use, npm does not provide a normal third-party OAuth flow. Use a
guided token setup:

1. `connect npm`
2. open local browser setup page
3. link to npm granular access token settings
4. explain least-privilege token selection
5. accept token
6. validate with npm identity endpoint
7. store token in `~/.config/agentic-devtools/npm.json`

Supported auth sources:

- `NPM_TOKEN`
- `NODE_AUTH_TOKEN`
- explicit `.npmrc` auth token
- local Agentic Devtools npm config

For package publishing, prefer GitHub Actions Trusted Publishing through OIDC.
The local npm tool may support publishing for controlled use cases, but real
publishes must be explicit and confirmation-gated. Dry-run should be the default.

## Hosted Connect Option

A future hosted “Agentic Devtools Connect” service could reduce friction further.

Potential benefits:

- true OAuth-style web connection for providers that support OAuth
- stable callback URLs
- hosted token broker
- stable egress IP for providers that require IP allowlisting

Costs and risks:

- secure secret storage
- token revocation flows
- account access auditability
- uptime responsibility
- abuse prevention
- paid infrastructure

Do not introduce hosted auth casually. The open-source package should work
locally first.

## Security Requirements

Auth flows must follow these rules:

- never print token values
- never commit credentials
- store local files with restrictive permissions when possible
- prefer least-privilege tokens
- validate credentials before reporting setup success
- make disconnect explicit and reliable
- document where credentials are stored
- keep write tools gated behind narrow, explicit actions

## MCP Authorization Note

For local stdio MCP servers, credentials should be resolved from environment
variables or local storage. The MCP authorization specification says stdio
transports should not use the HTTP OAuth flow directly.

If Agentic Devtools later ships a hosted HTTP MCP server, that server should
follow the MCP authorization model and OAuth best practices.

## Implementation Checklist For New Tools

When adding a new tool, define:

- auth tier: OAuth, guided token, or guided manual
- required credentials
- least-privilege recommendation
- local config file shape
- env var overrides
- `connect`
- `disconnect`
- `auth-status`
- `test-connection`
- MCP host config example
- security caveats

If a provider cannot support one-click setup, say so directly and provide the
shortest guided setup path.
