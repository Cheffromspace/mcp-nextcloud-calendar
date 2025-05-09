# Migrating to Cloudflare Workers

This document provides a comprehensive guide for migrating the MCP Nextcloud Calendar server from Express.js to Cloudflare Workers.

## Table of Contents

1. [Overview](#overview)
2. [Architecture Changes](#architecture-changes)
3. [Cloudflare Workers Setup](#cloudflare-workers-setup)
4. [Migrating Core Components](#migrating-core-components)
   - [MCP Tools Conversion](#mcp-tools-conversion)
   - [XML Processing](#xml-processing)
   - [Calendar Services](#calendar-services)
   - [Event Services](#event-services)
5. [State Management with Durable Objects](#state-management-with-durable-objects)
6. [Authentication and Secrets](#authentication-and-secrets)
7. [Multi-tenant Support](#multi-tenant-support)
8. [Testing Strategy](#testing-strategy)
9. [Deployment Pipeline](#deployment-pipeline)
10. [Performance Considerations](#performance-considerations)
11. [Troubleshooting](#troubleshooting)

## Overview

The MCP Nextcloud Calendar server is being migrated from Express.js to Cloudflare Workers to leverage:

- Global distribution with low latency
- Enhanced reliability and scalability
- Simplified deployment and maintenance
- Built-in security features
- Multi-tenant support via Durable Objects

This migration involves significant architectural changes while maintaining all existing functionality.

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

## Cloudflare Workers Setup

### Prerequisites

- Cloudflare account with Workers subscription
- Wrangler CLI installed
- Node.js v18+ installed

### Initial Setup

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

## Migrating Core Components

### MCP Tools Conversion

#### Express.js MCP Server Definition (Current)

```typescript
// Current implementation
const server = new McpServer({
  name: serverConfig.serverName,
  version: serverConfig.serverVersion,
});

server.tool('listCalendars', {}, async () => {
  try {
    const calendars = await calendarService.getCalendars();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, calendars }, null, 2),
        },
      ],
    };
  } catch (error) {
    return handleCalendarToolError('retrieve calendars', error);
  }
});
```

#### Cloudflare Workers MCP Conversion (Target)

```typescript
// Target implementation
export default class CalendarWorker extends WorkerEntrypoint<Env> {
  /**
   * Lists all available calendars
   * @return The calendars from Nextcloud
   */
  async listCalendars() {
    try {
      const calendarService = new CalendarService(this.env);
      const calendars = await calendarService.getCalendars();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, calendars }, null, 2),
          },
        ],
      };
    } catch (error) {
      return this.handleCalendarToolError('retrieve calendars', error);
    }
  }
  
  /**
   * Handles errors for calendar operations
   */
  private handleCalendarToolError(operation: string, error: unknown) {
    console.error(`Error in ${operation} tool:`, error);
    const sanitizedMessage = this.sanitizeError(error).message;
    
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to ${operation}: ${sanitizedMessage}`,
        },
      ],
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

### XML Processing

The XML processing is one of the most critical components to migrate. There are two approaches:

#### Option 1: Use Node.js Compatibility

Enable Node.js compatibility to use `xml2js` directly:

```typescript
// wrangler.toml
compatibility_flags = ["nodejs_compat"]
```

This approach minimizes code changes but may have performance implications.

#### Option 2: Use Web Standard APIs

Replace `xml2js` with DOM-based parsing for better performance:

```typescript
export class WebXmlService {
  // Parse XML using DOMParser (web standard)
  async parseXml(xmlString: string, options: ParseOptions = {}): Promise<Record<string, unknown>> {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");
      
      // Check for parsing errors
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        throw new XmlParsingError(
          `XML parsing failed: ${parserError.textContent}`,
          xmlString,
          options,
          new Error(parserError.textContent || "Unknown parsing error"),
          false
        );
      }
      
      // Convert DOM to object structure
      return this.domToObject(xmlDoc);
    } catch (error) {
      throw new XmlParsingError(
        `XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        xmlString,
        options,
        error,
        false
      );
    }
  }
  
  // Convert DOM to object structure (similar to xml2js output)
  private domToObject(node: Node): Record<string, unknown> {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue ? { "#text": node.nodeValue } : {};
    }
    
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return {};
    }
    
    const element = node as Element;
    const result: Record<string, unknown> = {};
    
    // Handle attributes
    if (element.attributes.length > 0) {
      result["$"] = {};
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        (result["$"] as Record<string, string>)[attr.name] = attr.value;
      }
    }
    
    // Handle child nodes
    const childNodes = Array.from(element.childNodes);
    if (childNodes.length === 0) {
      return result;
    }
    
    // If only text nodes, return text content
    if (childNodes.every(node => node.nodeType === Node.TEXT_NODE)) {
      return { ...result, "#text": element.textContent };
    }
    
    // Process child elements
    for (const child of childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childElement = child as Element;
        const childName = childElement.nodeName;
        const childResult = this.domToObject(child);
        
        if (result[childName]) {
          // Convert to array if multiple elements with same name
          if (!Array.isArray(result[childName])) {
            result[childName] = [result[childName]];
          }
          (result[childName] as Array<unknown>).push(childResult);
        } else {
          result[childName] = childResult;
        }
      }
    }
    
    return result;
  }
  
  // Serializing DOM to string
  serializeToString(document: Document): string {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(document);
  }
}
```

#### Recommended Approach

1. Start with Option 1 (Node.js compatibility) for faster migration
2. Profile performance and gradually implement Option 2 for critical paths
3. Create adapter classes to maintain the same interface for both approaches

### Calendar Services

The Calendar Service needs to be adapted to use the Fetch API instead of axios:

```typescript
export class CalendarService {
  private baseUrl: string;
  private authHeader: string;
  private xmlService: XmlService;
  
  constructor(config: NextcloudConfig) {
    this.baseUrl = config.baseUrl;
    this.authHeader = 'Basic ' + btoa(`${config.username}:${config.appToken}`);
    this.xmlService = new XmlService();
  }
  
  async getCalendars(): Promise<Calendar[]> {
    const url = `${this.baseUrl}/remote.php/dav/calendars/${this.username}/`;
    const xmlRequest = this.buildPropfindRequest();
    
    try {
      const response = await fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': '1',
          'Authorization': this.authHeader
        },
        body: xmlRequest
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch calendars: ${response.status}`);
      }
      
      const xmlData = await response.text();
      const parsedData = await this.xmlService.parseXml(xmlData);
      
      // Rest of processing remains the same
      // ...
    } catch (error) {
      // Error handling
    }
  }
  
  // Other methods follow the same pattern
}
```

### Event Services

The Event Service needs a similar adaptation to the Fetch API.

## State Management with Durable Objects

Durable Objects provide persistent storage for state across Worker invocations.

### Session Management

```typescript
export class SessionStore implements DurableObject {
  private state: DurableObjectState;
  private sessions: Map<string, SessionData>;

  constructor(state: DurableObjectState) {
    this.state = state;
    this.sessions = new Map();
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("sessions") as Map<string, SessionData>;
      if (stored) {
        this.sessions = stored;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("id");
    
    if (!sessionId) {
      return new Response("Missing session ID", { status: 400 });
    }
    
    if (request.method === "GET") {
      const session = this.sessions.get(sessionId);
      if (!session) {
        return new Response("Session not found", { status: 404 });
      }
      return new Response(JSON.stringify(session));
    }
    
    if (request.method === "POST") {
      const data = await request.json() as SessionData;
      this.sessions.set(sessionId, data);
      await this.state.storage.put("sessions", this.sessions);
      return new Response("Session stored");
    }
    
    if (request.method === "DELETE") {
      this.sessions.delete(sessionId);
      await this.state.storage.put("sessions", this.sessions);
      return new Response("Session deleted");
    }
    
    return new Response("Method not allowed", { status: 405 });
  }
}
```

### Calendar Data Caching

```typescript
export class CalendarCache implements DurableObject {
  private state: DurableObjectState;
  private cache: Map<string, CachedCalendar>;
  
  constructor(state: DurableObjectState) {
    this.state = state;
    this.cache = new Map();
    this.state.blockConcurrencyWhile(async () => {
      const stored = await this.state.storage.get("cache") as Map<string, CachedCalendar>;
      if (stored) {
        this.cache = stored;
      }
    });
  }
  
  async fetch(request: Request): Promise<Response> {
    // Implementation for caching calendar data
    // ...
  }
}
```

## Authentication and Secrets

### Managing Nextcloud Credentials

Store credentials in Cloudflare Secret Manager:

```bash
# Set secrets via Wrangler
wrangler secret put NEXTCLOUD_BASE_URL
wrangler secret put NEXTCLOUD_USERNAME
wrangler secret put NEXTCLOUD_APP_TOKEN
```

Access secrets in your Worker:

```typescript
export interface Env {
  NEXTCLOUD_BASE_URL: string;
  NEXTCLOUD_USERNAME: string;
  NEXTCLOUD_APP_TOKEN: string;
  SESSIONS: DurableObjectNamespace;
  CALENDARS: DurableObjectNamespace;
}

export default class CalendarWorker implements ExportedHandler<Env> {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = {
      baseUrl: env.NEXTCLOUD_BASE_URL,
      username: env.NEXTCLOUD_USERNAME,
      appToken: env.NEXTCLOUD_APP_TOKEN,
    };
    
    // Use configuration...
  }
}
```

## Multi-tenant Support

Implement multi-tenant support using Durable Objects and request routing:

```typescript
async handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const tenantId = url.searchParams.get("tenant") || "default";
  
  // Create a unique ID for this tenant's data
  const id = env.CALENDARS.idFromName(tenantId);
  const calendarCache = env.CALENDARS.get(id);
  
  // Forward the request to the specific tenant's Durable Object
  return await calendarCache.fetch(request);
}
```

## Testing Strategy

1. **Unit Testing**: Test individual components in isolation
   ```bash
   # Install testing dependencies
   npm install -D vitest @vitest/coverage-v8 msw
   ```

2. **Integration Testing**: Test the Workers runtime with Miniflare
   ```bash
   # Install Miniflare for local testing
   npm install -D miniflare
   ```

3. **End-to-End Testing**: Test against real Cloudflare Workers environment
   ```bash
   # Configure test environment in wrangler.toml
   [env.test]
   name = "mcp-nextcloud-calendar-test"
   ```

4. Test XML compatibility:
   ```typescript
   import { expect, test, describe } from 'vitest';
   import { XmlService } from '../src/services/xml/xml-service';
   
   describe('XmlService', () => {
     test('should parse XML correctly', async () => {
       const xmlService = new XmlService();
       const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
         <d:multistatus xmlns:d="DAV:">
           <d:response>
             <d:href>/calendars/user/test/</d:href>
             <d:propstat>
               <d:prop>
                 <d:displayname>Test Calendar</d:displayname>
               </d:prop>
               <d:status>HTTP/1.1 200 OK</d:status>
             </d:propstat>
           </d:response>
         </d:multistatus>`;
       
       const result = await xmlService.parseXml(xmlString);
       expect(result).toHaveProperty('d:multistatus');
     });
   });
   ```

## Deployment Pipeline

1. Create a GitHub Actions workflow for CI/CD:

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches:
      - main
  pull_request:
    branches:
      - main

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm test

  deploy:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run deploy
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

2. Add deployment scripts to package.json:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "deploy": "wrangler deploy"
  }
}
```

## Performance Considerations

1. **Cold Starts**: Workers have minimal cold start time, but optimize initialization
2. **XML Processing**: Consider streaming approaches for large XML payloads
3. **Caching**: Use Durable Objects to cache frequent requests
4. **Bundle Size**: Keep dependencies minimal
5. **Memory Usage**: Be mindful of the 128MB limit per invocation

## Troubleshooting

### Common Issues

1. **CORS Issues**:
   - Configure proper CORS headers:
   ```typescript
   new Response(body, {
     headers: {
       "Access-Control-Allow-Origin": "*",
       "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
       "Access-Control-Allow-Headers": "Content-Type, Authorization"
     }
   });
   ```

2. **XML Parsing Errors**:
   - Check if `nodejs_compat` flag is enabled
   - Verify XML structure is valid
   - Add logging to debug parsing issues

3. **Durable Object Storage Limits**:
   - Keep stored data under 128KB per key
   - Use efficient serialization
   - Implement pagination for large datasets

4. **Request Timeouts**:
   - Workers have a 30-second maximum execution time
   - Optimize Nextcloud API calls
   - Implement caching for slow operations

5. **Environment Variable Issues**:
   - Verify secrets are properly set
   - Check for typos in environment variable names
   - Use wrangler secret list to confirm configuration