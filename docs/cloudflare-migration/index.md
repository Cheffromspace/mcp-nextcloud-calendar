# Migrating to Cloudflare Workers

This documentation series provides a comprehensive guide for migrating the MCP Nextcloud Calendar server from Express.js to Cloudflare Workers.

## Guide Contents

1. [Overview](./01-overview.md) - Introduction and architecture changes
2. [Setup and Configuration](./02-setup.md) - Initial setup and environment configuration
3. [MCP Tools Migration](./03-mcp-tools.md) - Converting MCP tools to Workers format
4. [XML Processing](./04-xml-processing.md) - Adapting XML processing for Workers

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

## Why Modular Documentation?

Breaking the migration guide into smaller, focused documents provides several benefits:

1. **Easier maintenance** - Each section can be updated independently
2. **Improved readability** - Shorter documents are easier to navigate
3. **Modular implementation** - Teams can work on different aspects in parallel
4. **Progressive adoption** - Migration can be done in stages

## Next Steps

Start with the [Overview](./01-overview.md) to understand the migration process at a high level.