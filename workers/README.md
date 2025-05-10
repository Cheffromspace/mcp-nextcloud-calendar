# MCP Nextcloud Calendar - Cloudflare Workers

This is the Cloudflare Workers implementation of the MCP Nextcloud Calendar server. It replaces the Express.js implementation while maintaining the same functionality and API.

## Features

- Global distribution with low latency
- Enhanced reliability and scalability
- Simplified deployment and maintenance
- Built-in security features
- Multi-tenant support via Durable Objects
- Improved developer experience

## Architecture

### Core Components

1. **MCP Service**
   - Implements the Model Context Protocol for AI agent integration
   - Supports both the latest Streamable HTTP transport (March 2025 spec) and legacy HTTP+SSE transport
   - Handles session management and connection keep-alive

2. **Calendar Service**
   - Communicates with Nextcloud's CalDAV API
   - Retrieves calendar information using WebDAV PROPFIND requests
   - Handles authentication via Basic Auth with Nextcloud
   - Includes ADHD-friendly organization features

3. **State Management**
   - Uses Durable Objects for persistence
   - Manages session state
   - Implements caching for calendar and event data

4. **XML Processing**
   - Uses Web Standard XML APIs (DOMParser, XMLSerializer)
   - Supports CalDAV XML formatting and parsing

## Setup and Development

### Prerequisites

- Node.js v18 or later
- Wrangler CLI
- Cloudflare account with Workers subscription

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment variables:
   - Copy `.dev.vars.example` to `.dev.vars`
   - Fill in your Nextcloud credentials

### Development

Run the development server:
```bash
npm run dev
```

This will start Wrangler's development server, which will:
- Watch for file changes
- Provide a local endpoint for testing
- Connect to Cloudflare for authentication and Durable Objects

### Testing

Run tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

### Deployment

Deploy to development environment:
```bash
npm run deploy
```

Deploy to staging environment:
```bash
npm run deploy:staging
```

Deploy to production environment:
```bash
npm run deploy:production
```

## Environment Configuration

Each environment (development, staging, production) has its own configuration in `wrangler.toml`:

```toml
[env.dev]
name = "mcp-nextcloud-calendar-dev"

[env.staging]
name = "mcp-nextcloud-calendar-staging"

[env.production]
name = "mcp-nextcloud-calendar"
```

### Secrets

Set secrets for each environment using the Wrangler CLI:

```bash
wrangler secret put NEXTCLOUD_BASE_URL --env staging
wrangler secret put NEXTCLOUD_USERNAME --env staging
wrangler secret put NEXTCLOUD_APP_TOKEN --env staging
```

## API Endpoints

The Worker exposes the following endpoints:

- `/mcp` - MCP Streamable HTTP transport endpoint (March 2025 spec)
- `/health` - Health check endpoint

## MCP Tools

The Worker provides the following MCP tools:

- `listCalendars` - Retrieves calendars from Nextcloud
- `createCalendar` - Creates a new calendar
- `updateCalendar` - Updates an existing calendar
- `deleteCalendar` - Deletes a calendar
- `listEvents` - Retrieves events from a calendar
- `createEvent` - Creates a new event
- `updateEvent` - Updates an existing event
- `deleteEvent` - Deletes an event

## Project Structure

```
workers/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── config.ts                # Configuration
│   ├── models/                  # Data models
│   │   └── calendar.ts
│   ├── services/                # Service implementations
│   │   ├── calendar/
│   │   │   ├── http-client.ts
│   │   │   └── index.ts
│   │   └── xml/
│   │       ├── xml-service.ts
│   │       ├── caldav-xml-builder.ts
│   │       └── index.ts
│   ├── durable-objects/         # State management
│   │   ├── session-store.ts
│   │   └── calendar-cache.ts
│   ├── types/                   # TypeScript types
│   │   ├── env.ts
│   │   ├── mcp.ts
│   │   └── durable-objects.ts
│   └── utils/                   # Utility functions
├── test/                        # Tests
├── wrangler.toml                # Cloudflare configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

## Migration from Express.js

This implementation is part of a migration from the original Express.js implementation. Key differences include:

1. **HTTP Client** - Uses Fetch API instead of Axios
2. **XML Processing** - Uses Web Standard APIs instead of xml2js
3. **State Management** - Uses Durable Objects instead of in-memory state
4. **Transport Layer** - Uses Workers runtime instead of Express.js

## Further Reading

For more information about the migration, see the docs in `/docs/cloudflare-migration/`.