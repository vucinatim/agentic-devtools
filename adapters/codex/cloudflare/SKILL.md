---
name: cloudflare
description: Use the Cloudflare plugin to inspect and manage DNS zones, DNS records, Cloudflare Tunnels, and R2 buckets or bucket domains through Agentic Devtools.
---

# Cloudflare

Use this plugin when the user needs to work with Cloudflare-managed DNS,
Cloudflare Tunnels, or R2 bucket configuration.

## Intended Scope

- Read zone details
- Read and mutate DNS records
- Read and mutate Cloudflare Tunnels
- Read tunnel configuration, token, and connection state
- Read and mutate R2 buckets
- Read and mutate managed and custom R2 bucket domains
- Support common setup flows such as domain verification, origin routing, and
  storage public-access configuration

## Current MCP Tools

- `getCloudflareAuthStatus`
- `connectCloudflare`
- `disconnectCloudflare`
- `testCloudflareConnection`
- `listCloudflareZones`
- `listCloudflareTunnels`
- `getCloudflareTunnel`
- `createCloudflareTunnel`
- `updateCloudflareTunnel`
- `deleteCloudflareTunnel`
- `getCloudflareTunnelToken`
- `getCloudflareTunnelConfiguration`
- `updateCloudflareTunnelConfiguration`
- `listCloudflareTunnelConnections`
- `cleanupCloudflareTunnelConnections`
- `getCloudflareZone`
- `listCloudflareDnsRecords`
- `getCloudflareDnsRecord`
- `createCloudflareDnsRecord`
- `updateCloudflareDnsRecord`
- `deleteCloudflareDnsRecord`
- `listCloudflareR2Buckets`
- `getCloudflareR2Bucket`
- `createCloudflareR2Bucket`
- `updateCloudflareR2Bucket`
- `deleteCloudflareR2Bucket`
- `getCloudflareR2ManagedDomain`
- `updateCloudflareR2ManagedDomain`
- `listCloudflareR2CustomDomains`
- `getCloudflareR2CustomDomain`
- `createCloudflareR2CustomDomain`
- `updateCloudflareR2CustomDomain`
- `deleteCloudflareR2CustomDomain`

## Architecture Note

Keep the public plugin surface explicit:

- use direct record and bucket CRUD operations instead of vague "fix DNS" tools
- keep token handling and raw HTTP details inside the shared `src/` layer
- resolve account, tunnel, and zone targets by human names when possible
- fall back to explicit provider ids only when names are ambiguous

## Auth Model

Cloudflare uses scoped API tokens.

Use `connectCloudflare` to open a browser-based setup flow and store local
credentials, or provide credentials through environment variables for stateless
setups.

Recommended token scopes for DNS, Tunnel, and R2:

- `Zone Zone Read`
- `DNS Read`
- `DNS Write`
- `Cloudflare Tunnel Read`
- `Cloudflare Tunnel Write`
- `Workers R2 Storage Read`
- `Workers R2 Storage Edit`
