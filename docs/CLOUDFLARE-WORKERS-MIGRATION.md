# Migrating to Cloudflare Workers

This document provides an overview of migrating the MCP Nextcloud Calendar server from Express.js to Cloudflare Workers.

## Migration Guide Structure

The complete migration guide has been split into modular sections for better organization and readability. Please see the detailed documentation in the [cloudflare-migration directory](./cloudflare-migration/index.md).

## Topics Covered

1. **[Overview](./cloudflare-migration/01-overview.md)** - Introduction and architecture changes
2. **[Setup and Configuration](./cloudflare-migration/02-setup.md)** - Initial setup and environment configuration
3. **[MCP Tools Migration](./cloudflare-migration/03-mcp-tools.md)** - Converting MCP tools to Workers format
4. **[XML Processing](./cloudflare-migration/04-xml-processing.md)** - Adapting XML processing for Workers

Additional sections are being developed to cover:

- Calendar Services
- State Management
- Authentication and Security
- Multi-tenant Support
- Monitoring and Logging
- Testing Strategy
- Deployment Pipeline
- Backward Compatibility
- Performance Optimization
- Troubleshooting

## Related Issues

This migration guide is related to [Issue #48: Migrate MCP Server to Cloudflare Workers](https://github.com/Cheffromspace/mcp-nextcloud-calendar/issues/48).

## Getting Started

To begin the migration process, start with the [Overview](./cloudflare-migration/01-overview.md) document.