# Cloudflare Workers Setup

This document covers the initial setup and configuration for migrating to Cloudflare Workers.

## Prerequisites

- Cloudflare account with Workers subscription
- Wrangler CLI installed
- Node.js v18+ installed

## Initial Setup

1. Install Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

2. Login to Cloudflare:
   ```bash
   wrangler login
   ```

3. Initialize project structure:
   ```bash
   mkdir -p mcp-nextcloud-calendar
   cd mcp-nextcloud-calendar
   npm init -y
   npm install workers-mcp
   npm install -D wrangler @cloudflare/workers-types
   ```

4. Configure `wrangler.toml`:
   ```toml
   name = "mcp-nextcloud-calendar"
   main = "src/index.ts"
   compatibility_date = "2025-02-22"
   compatibility_flags = ["nodejs_compat"]

   [durable_objects]
   bindings = [
     { name = "SESSIONS", class_name = "SessionStore" },
     { name = "CALENDARS", class_name = "CalendarCache" }
   ]

   [[migrations]]
   tag = "v1"
   new_classes = ["SessionStore", "CalendarCache"]
   ```

5. Configure TypeScript:
   ```json
   // tsconfig.json
   {
     "compilerOptions": {
       "target": "ES2020",
       "module": "ES2020",
       "lib": ["ES2020", "WebWorker"],
       "types": ["@cloudflare/workers-types"],
       "moduleResolution": "node",
       "strict": true,
       "noImplicitAny": true,
       "outDir": "dist",
       "esModuleInterop": true
     },
     "include": ["src/**/*.ts"]
   }
   ```

## Environment Configuration

### Development Environment

For local development, use `.dev.vars` files to manage environment variables:

```bash
# Create a .dev.vars file (excluded from Git)
echo "NEXTCLOUD_BASE_URL=https://dev-nextcloud.example.com" > .dev.vars
echo "NEXTCLOUD_USERNAME=dev-user" >> .dev.vars
echo "NEXTCLOUD_APP_TOKEN=dev-token" >> .dev.vars
```

Then reference these in your `wrangler.toml`:

```toml
[env.dev]
name = "mcp-nextcloud-calendar-dev"
# No secrets defined here as they come from .dev.vars
```

This approach keeps secrets out of your Git repository while making them available during local development.

### Staging Environment

Create a staging environment for testing:

```toml
[env.staging]
name = "mcp-nextcloud-calendar-staging"
# Staging-specific settings
```

Set staging secrets:

```bash
wrangler secret put NEXTCLOUD_BASE_URL --env staging
wrangler secret put NEXTCLOUD_USERNAME --env staging
wrangler secret put NEXTCLOUD_APP_TOKEN --env staging
```

### Production Environment

Configure production settings:

```toml
[env.production]
name = "mcp-nextcloud-calendar"
# Production-specific settings
```

Set production secrets:

```bash
wrangler secret put NEXTCLOUD_BASE_URL --env production
wrangler secret put NEXTCLOUD_USERNAME --env production
wrangler secret put NEXTCLOUD_APP_TOKEN --env production
```

## Project Structure

Organize your Worker project with the following structure:

```
mcp-nextcloud-calendar/
├── src/
│   ├── index.ts                 # Main entry point
│   ├── models/                  # Data models
│   │   └── calendar.ts
│   ├── services/                # Service implementations
│   │   ├── calendar/
│   │   │   ├── calendar-service.ts
│   │   │   └── event-service.ts
│   │   └── xml/
│   │       ├── xml-service.ts
│   │       └── caldav-xml-builder.ts
│   ├── durable-objects/         # State management
│   │   ├── session-store.ts
│   │   └── calendar-cache.ts
│   └── utils/                   # Utility functions
│       └── logger.ts
├── test/                        # Tests
├── wrangler.toml                # Cloudflare configuration
├── tsconfig.json                # TypeScript configuration
└── package.json                 # Dependencies and scripts
```

## Basic Worker Example

Here's a minimal example of a Cloudflare Worker that implements the MCP protocol:

```typescript
import { WorkerEntrypoint } from "cloudflare:workers"
import { ProxyToSelf } from "workers-mcp"

export interface Env {
  NEXTCLOUD_BASE_URL: string;
  NEXTCLOUD_USERNAME: string;
  NEXTCLOUD_APP_TOKEN: string;
  SESSIONS: DurableObjectNamespace;
  CALENDARS: DurableObjectNamespace;
}

export default class CalendarWorker extends WorkerEntrypoint<Env> {
  /**
   * Gets server health information
   * @return Health status of the calendar server
   */
  async getHealth() {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            status: "healthy",
            version: "1.0.0",
            environment: this.env.ENVIRONMENT || "development"
          }, null, 2)
        }
      ]
    };
  }

  /**
   * Entry point for the Worker
   */
  async fetch(request: Request): Promise<Response> {
    return new ProxyToSelf(this).fetch(request);
  }
}
```

## Testing the Setup

Test your Worker locally:

```bash
wrangler dev
```

This will start a development server and you can test your Worker by visiting:

```
http://localhost:8787
```

## Next Steps

Once your basic setup is confirmed working, you can proceed to migrate the MCP tools as described in [MCP Tools Migration](./03-mcp-tools.md).