# Migrating to Cloudflare Workers: Overview

This document provides a high-level overview of the migration process from Express.js to Cloudflare Workers.

## Why Migrate?

Migrating our MCP Nextcloud Calendar server from Express.js to Cloudflare Workers offers several advantages:

- Global distribution with low latency
- Enhanced reliability and scalability
- Simplified deployment and maintenance
- Built-in security features
- Multi-tenant support via Durable Objects
- Improved developer experience

## Architecture Changes

### Current Architecture (Express.js)

The current architecture uses:
- Node.js with Express for HTTP handling
- MCP Server from `@modelcontextprotocol/sdk`
- XML processing via `xml2js`
- HTTP requests via `axios`
- In-memory state management
- Environment variables for configuration

### Target Architecture (Cloudflare Workers)

The target architecture will use:
- Cloudflare Workers runtime
- `workers-mcp` package for MCP protocol support
- Web standard XML APIs with Node.js compatibility when needed
- Fetch API for HTTP requests
- Durable Objects for state management
- Cloudflare Secret Manager for configuration
- Workers VPC for connecting to existing backend services (2025 feature)

### Workers VPC Integration

Cloudflare Workers VPC (released in 2025) allows Workers to connect directly to private networks and backend services. This significantly simplifies the architecture by:

1. Enabling direct connections to existing Nextcloud instances without public exposure
2. Supporting private network communication with other microservices
3. Maintaining security through private networking rather than public APIs
4. Reducing latency by avoiding public internet routing

To configure Workers VPC:

```toml
# wrangler.toml
[vpc]
id = "your-vpc-id"
routes = [
  # Define networks that the Worker should be able to access
  { network = "10.0.0.0/8" },
  { hostname = "nextcloud.internal.example.com" }
]
```

## Migration Strategy

Our migration will follow these key steps:

1. **Setup and Configuration**
   - Prepare the Cloudflare Workers environment
   - Configure networking and security

2. **Core Components Migration**
   - Adapt MCP tools to Workers format
   - Migrate XML processing
   - Convert calendar and event services

3. **State Management**
   - Implement Durable Objects for persistence
   - Set up session management

4. **Testing and Deployment**
   - Test all functionality in isolation
   - Deploy with backward compatibility
   - Monitor and gradually migrate traffic

5. **Performance Optimization**
   - Fine-tune for optimal performance
   - Address any bottlenecks

Each of these steps is documented in detail in the subsequent sections.

## Table of Contents

1. [Overview (this document)](./01-overview.md)
2. [Setup and Configuration](./02-setup.md)
3. [MCP Tools Migration](./03-mcp-tools.md)
4. [XML Processing](./04-xml-processing.md)
5. [Calendar Services](./05-calendar-services.md)
6. [State Management](./06-state-management.md)
7. [Authentication and Security](./07-auth-security.md)
8. [Multi-tenant Support](./08-multi-tenant.md)
9. [Monitoring and Logging](./09-monitoring.md)
10. [Testing Strategy](./10-testing.md)
11. [Deployment Pipeline](./11-deployment.md)
12. [Backward Compatibility](./12-compatibility.md)
13. [Performance Optimization](./13-performance.md)
14. [Troubleshooting](./14-troubleshooting.md)