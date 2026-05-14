---
name: namecheap
description: Use the Namecheap plugin to inspect domains, manage DNS records, and support domain configuration workflows through a small MCP surface.
---

# Namecheap

Use this plugin when the user needs to work with Namecheap-managed domains or DNS.

## Intended scope

- Read domain details
- Read and update DNS records
- Support common setup flows such as verification, redirects, and subdomain configuration

## Current MCP tools

- `getAuthStatus`
- `connectNamecheap`
- `disconnectNamecheap`
- `listDomains`
- `getDomainDns`
- `replaceDomainDns`
- `addDomainDnsRecord`
- `removeDomainDnsRecord`
- `updateDomainDnsRecord`

## Architecture note

Keep the public plugin surface small:

- expose stable MCP tools for domain and DNS operations
- keep raw API handling inside the shared `src/` layer
- add higher-level skills only after the MCP contract is stable

## Auth model

Namecheap uses API credentials plus IP whitelisting, not a normal OAuth token exchange.

Use `connectNamecheap` to open a browser-based setup flow and store local plugin credentials, or provide credentials via environment variables if you need a stateless setup.
