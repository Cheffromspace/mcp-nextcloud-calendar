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

This configuration allows your Worker to securely connect to your Nextcloud server on the private network.

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

#### MCP Protocol March 2025 Specification Updates

The latest MCP Protocol specification (March 2025) includes several important changes that we need to account for in our migration:

1. **Streamable HTTP Transport**
   - Unified endpoint for GET (SSE streams), POST (messages), and DELETE (session termination)
   - Streaming message support with metadata for partial responses
   - Better support for long-running operations

2. **Session Context**
   - Enhanced state management across multiple interactions
   - Support for context objects that persist for the duration of a session
   - Ability to reference previous results in subsequent tool calls

3. **Progressive Tool Results**
   - Support for tools that stream partial results as they become available
   - Progress indicators for long-running operations
   - Client-side rendering of incremental updates

4. **Authentication Enhancements**
   - OAuth 2.0 integration for secure delegated access
   - Scope-based permission model for tool access
   - Granular rate limiting and quota management

To implement these features in our Cloudflare Worker, we'll need to:

```typescript
// Enhanced Worker implementation with March 2025 spec support
export default class CalendarWorker extends WorkerEntrypoint<Env> {
  // Session storage using Durable Objects
  private sessions: DurableObjectNamespace;

  constructor(env: Env) {
    super();
    this.sessions = env.SESSIONS;
  }

  // Tool implementation with progressive results support
  /**
   * Lists all available calendars with streaming support
   * @param progressCallback Optional callback for streaming progress updates
   * @return The calendars from Nextcloud
   */
  async listCalendars(
    options?: { progressCallback?: ProgressCallback }
  ) {
    try {
      const sessionId = this.getSessionId();
      const sessionStorage = await this.getSessionStorage(sessionId);
      const calendarService = new CalendarService(this.env);

      // Send progressive updates if callback provided
      if (options?.progressCallback) {
        options.progressCallback({
          status: "in_progress",
          message: "Connecting to Nextcloud server...",
          progress: 0.1
        });
      }

      // Start retrieving calendars (potentially a longer operation)
      const calendarsPromise = calendarService.getCalendars();

      // Send intermediate progress while waiting
      if (options?.progressCallback) {
        options.progressCallback({
          status: "in_progress",
          message: "Retrieving calendar information...",
          progress: 0.5
        });
      }

      // Wait for results
      const calendars = await calendarsPromise;

      // Store in session context for future reference
      await sessionStorage.put("calendars", calendars);

      // Final completion
      if (options?.progressCallback) {
        options.progressCallback({
          status: "complete",
          message: "Calendars retrieved successfully",
          progress: 1.0
        });
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ success: true, calendars }, null, 2),
          },
        ],
        context: {
          // Store a reference ID that can be used in subsequent calls
          calendarResultRef: `session:${sessionId}:calendars`
        }
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
   * Gets or creates session storage
   */
  private async getSessionStorage(sessionId: string) {
    const id = this.sessions.idFromName(sessionId);
    const sessionObj = this.sessions.get(id);
    return sessionObj;
  }

  /**
   * Entry point for the Worker supporting the streamable HTTP transport
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle the unified MCP endpoint
    if (url.pathname === "/mcp") {
      // GET - establish SSE stream
      if (request.method === "GET") {
        return this.handleSseConnection(request);
      }

      // POST - handle message
      if (request.method === "POST") {
        return this.handleMessage(request);
      }

      // DELETE - terminate session
      if (request.method === "DELETE") {
        return this.handleSessionTermination(request);
      }
    }

    // Default to standard MCP handling
    return new ProxyToSelf(this).fetch(request);
  }

  // Implement streamable HTTP transport handlers (March 2025 spec)
  private async handleSseConnection(request: Request): Promise<Response> {
    // Implementation for SSE stream handling...
    // ...
  }

  private async handleMessage(request: Request): Promise<Response> {
    // Implementation for message handling...
    // ...
  }

  private async handleSessionTermination(request: Request): Promise<Response> {
    // Implementation for session termination...
    // ...
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
    // Handle non-element nodes
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue ? { "#text": node.nodeValue } : {};
    }

    if (node.nodeType === Node.CDATA_SECTION_NODE) {
      return { "#cdata": node.nodeValue };
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return {};
    }

    const element = node as Element;
    const result: Record<string, unknown> = {};
    let textContent = "";

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

    // Check for mixed content (text nodes and elements mixed together)
    let hasTextContent = false;
    let hasElementContent = false;

    for (const child of childNodes) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        if (child.nodeValue && child.nodeValue.trim()) {
          hasTextContent = true;
          textContent += child.nodeValue;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        hasElementContent = true;
      }
    }

    // If only text content, return it directly
    if (hasTextContent && !hasElementContent) {
      result["#text"] = textContent;
      return result;
    }

    // Process all child nodes for mixed content
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
      } else if (child.nodeType === Node.CDATA_SECTION_NODE) {
        // Handle CDATA sections
        if (!result["#cdata"]) {
          result["#cdata"] = [];
        }
        (result["#cdata"] as Array<string>).push(child.nodeValue || "");
      } else if (child.nodeType === Node.TEXT_NODE && child.nodeValue && child.nodeValue.trim()) {
        // Handle significant text in mixed content
        if (!result["#text"]) {
          result["#text"] = [];
        }
        (result["#text"] as Array<string>).push(child.nodeValue.trim());
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
    const url = `${this.baseUrl}/remote.php/dav/calendars/${this.config.username}/`;
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

### Environment-Specific Secret Management

Different environments (development, staging, production) require different secret management approaches:

#### Development Environment

For local development, use `.dev.vars` files to manage secrets:

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

#### Production Environment

For production, always use Cloudflare Secret Manager and never store credentials in code or configuration files:

```bash
# Set production secrets
wrangler secret put NEXTCLOUD_BASE_URL --env prod
wrangler secret put NEXTCLOUD_USERNAME --env prod
wrangler secret put NEXTCLOUD_APP_TOKEN --env prod
```

And reference the environment in your deployment:

```bash
wrangler deploy --env prod
```

### Security Best Practices

1. **Token Rotation**: Implement token rotation policies for Nextcloud app tokens
2. **Least Privilege**: Ensure Nextcloud users have minimal required permissions
3. **Secret Isolation**: Use different credentials for different environments
4. **Audit Logging**: Enable audit logging for secret access in Cloudflare
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

## Monitoring and Logging

Implementing proper monitoring and logging is essential for operational visibility in Cloudflare Workers:

### Structured Logging

```typescript
// Structured logging utility
export class WorkerLogger {
  private env: Env;
  private component: string;

  constructor(env: Env, component: string) {
    this.env = env;
    this.component = component;
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.log('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.log('warn', message, data);
  }

  error(message: string, error?: unknown, data?: Record<string, unknown>): void {
    const errorData = error instanceof Error
      ? { error: error.message, stack: error.stack, ...data }
      : { error, ...data };

    this.log('error', message, errorData);
  }

  debug(message: string, data?: Record<string, unknown>): void {
    // Only log in debug mode
    if (this.env.DEBUG_MODE === 'true') {
      this.log('debug', message, data);
    }
  }

  private log(level: string, message: string, data?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      component: this.component,
      message,
      ...data,
      // Add request context if available
      requestId: this.env.requestId
    };

    // In production, send to external logging service
    if (this.env.ENVIRONMENT === 'production' && this.env.LOG_DRAIN_URL) {
      fetch(this.env.LOG_DRAIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      }).catch(error => {
        // Fallback to console if external logging fails
        console.error('Failed to send log to external service', error);
        console.log(JSON.stringify(logEntry));
      });
    } else {
      // Local development logging
      console.log(JSON.stringify(logEntry));
    }
  }
}
```

### Worker Analytics

1. Configure Cloudflare Worker Analytics in your `wrangler.toml`:

```toml
[observability]
enabled = true
head_sampling_rate = 1.0
```

2. Setup custom metrics for meaningful insights:

```typescript
// Custom metrics for calendar operations
export class CalendarMetrics {
  private env: Env;

  constructor(env: Env) {
    this.env = env;
  }

  recordCalendarFetch(tenantId: string, calendarCount: number, durationMs: number): void {
    // Log metric data that Workers Analytics will capture
    console.log(JSON.stringify({
      metric: "calendar_fetch",
      tenant_id: tenantId,
      calendar_count: calendarCount,
      duration_ms: durationMs,
      timestamp: Date.now()
    }));
  }

  recordEventFetch(tenantId: string, calendarId: string, eventCount: number, durationMs: number): void {
    console.log(JSON.stringify({
      metric: "event_fetch",
      tenant_id: tenantId,
      calendar_id: calendarId,
      event_count: eventCount,
      duration_ms: durationMs,
      timestamp: Date.now()
    }));
  }
}
```

### Building a Dashboard

Create a Cloudflare dashboard to monitor your Workers:

1. Worker health metrics
2. API call volumes by tenant
3. Error rates and types
4. Performance metrics including response times
5. Custom alerts for error thresholds and performance degradation

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

     test('should properly handle CDATA sections', async () => {
       const xmlService = new XmlService();
       const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
         <calendar>
           <description><![CDATA[This is a <strong>formatted</strong> description]]></description>
         </calendar>`;

       const result = await xmlService.parseXml(xmlString);
       expect(result).toHaveProperty('calendar');
       expect(result.calendar).toHaveProperty('description');
       expect(result.calendar.description).toHaveProperty('#cdata');
     });

     test('should handle mixed content correctly', async () => {
       const xmlService = new XmlService();
       const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
         <item>Text before <em>emphasized</em> and text after</item>`;

       const result = await xmlService.parseXml(xmlString);
       expect(result.item).toHaveProperty('#text');
       expect(result.item).toHaveProperty('em');
     });
   });
   ```

5. **Security Testing**: Include specific tests for security concerns

   ```typescript
   describe('XML Security', () => {
     test('should prevent XXE attacks', async () => {
       const xmlService = new XmlService();
       const maliciousXml = `<?xml version="1.0" encoding="UTF-8"?>
         <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
         <calendar>
           <name>&xxe;</name>
         </calendar>`;

       // Should throw an error or sanitize the content
       await expect(xmlService.parseXml(maliciousXml)).rejects.toThrow();
     });
   });
   ```

## Backward Compatibility

During migration, you may need to run both Express.js and Cloudflare Workers implementations simultaneously to ensure a smooth transition.

### Dual Deployment Strategy

1. **Phase 1: Development and Testing**
   - Deploy Cloudflare Worker to test environment
   - Keep Express server running as primary service
   - Test Worker functionality in isolation

2. **Phase 2: Parallel Production**
   - Deploy Worker to production but with restricted access
   - Set up traffic splitting for controlled testing:

```typescript
// In your Express application
app.use('/api/calendars', async (req, res, next) => {
  // Check if the request should be routed to Cloudflare
  const useCloudflare = shouldUseCloudflare(req);

  if (useCloudflare) {
    try {
      // Forward to Cloudflare Worker
      const workerResp = await fetch(`${WORKER_URL}/api/calendars${req.url}`, {
        method: req.method,
        headers: {...req.headers, 'X-Forwarded-From': 'express'},
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined
      });

      // Send Cloudflare response back to client
      res.status(workerResp.status);
      const respBody = await workerResp.text();
      res.send(respBody);

      // Log metrics for comparison
      console.log('Request handled by Cloudflare Worker', {
        path: req.url,
        status: workerResp.status,
        responseTime: Date.now() - req.startTime
      });
    } catch (error) {
      // Fallback to Express on error
      console.error('Cloudflare Worker error, falling back to Express', error);
      next();
    }
  } else {
    // Use Express handler directly
    next();
  }
});
```

3. **Phase 3: Complete Migration**
   - Redirect all traffic to Cloudflare Worker
   - Keep Express server running as fallback for a set period
   - Monitor for any issues before final shutdown

### Compatibility API Layer

Create a compatibility layer in your Cloudflare Worker to handle any API differences:

```typescript
async function handleLegacyRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  // Check for legacy API patterns
  if (url.pathname.startsWith('/api/v1/')) {
    // Map legacy endpoints to new structure
    if (url.pathname === '/api/v1/get-calendars') {
      // Rewrite to new endpoint format
      url.pathname = '/api/calendars';

      // Create modified request
      const newRequest = new Request(url.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body
      });

      // Process with new handler
      const response = await handleCalendarRequest(newRequest);

      // Transform response to match legacy format if needed
      const responseData = await response.json();
      const legacyResponse = transformToLegacyFormat(responseData);

      return new Response(JSON.stringify(legacyResponse), {
        headers: {
          'Content-Type': 'application/json',
          'X-Compatibility-Mode': 'legacy'
        }
      });
    }
  }

  // Pass through for modern API requests
  return null;
}
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
      - name: Security scanning
        run: npm run security-scan
      - name: Code coverage
        run: npm run test:coverage
      - name: Upload coverage reports
        uses: codecov/codecov-action@v3
        with:
          token: ${{ secrets.CODECOV_TOKEN }}

  deploy-staging:
    needs: test
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - name: Deploy to staging
        run: npm run deploy:staging
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Run integration tests
        run: npm run test:integration
        env:
          TEST_ENDPOINT: ${{ steps.deploy.outputs.url }}

  deploy-production:
    needs: test
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm ci
      - name: Deploy to production
        run: npm run deploy:production
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      - name: Run smoke tests
        run: npm run test:smoke
        env:
          PROD_ENDPOINT: ${{ steps.deploy.outputs.url }}
```

2. Add deployment scripts to package.json:

```json
{
  "scripts": {
    "dev": "wrangler dev",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:integration": "vitest run integration",
    "test:smoke": "vitest run smoke",
    "security-scan": "snyk test",
    "deploy:staging": "wrangler deploy --env staging",
    "deploy:production": "wrangler deploy --env production"
  }
}
```

## Security Considerations

### Authentication Flow Security

When migrating authentication from Express.js to Cloudflare Workers, consider these key differences:

1. **Token Handling**:
   - Express.js often uses session cookies or JWT tokens stored in memory
   - Workers should use encrypted tokens with appropriate security headers
   - Implement PASETO tokens instead of JWT when possible for better security

2. **CSRF Protection**:
   - Express.js typically uses middleware like `csurf`
   - Workers need custom CSRF protection implementation
   - Example implementation:

```typescript
function generateCsrfToken(sessionId: string): string {
  // Create HMAC-based token with timestamp
  const timestamp = Date.now();
  const message = `${sessionId}:${timestamp}`;

  // In a real implementation, use a proper HMAC function
  // This is a simplified example
  const signature = hashString(message + CSRF_SECRET);
  return `${timestamp}:${signature}`;
}

function validateCsrfToken(token: string, sessionId: string): boolean {
  const [timestamp, signature] = token.split(':');

  // Check token age (10 minute expiry)
  const now = Date.now();
  if (now - parseInt(timestamp) > 10 * 60 * 1000) {
    return false;
  }

  // Verify signature
  const message = `${sessionId}:${timestamp}`;
  const expectedSignature = hashString(message + CSRF_SECRET);
  return signature === expectedSignature;
}
```

3. **Secure Headers**:
   - Automatically implement security headers in all responses:

```typescript
function addSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);

  // Add security headers
  headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Content-Security-Policy', "default-src 'self'");
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
```

4. **OAuth Integration**:
   - Leverage Cloudflare Access for authentication
   - Use JWT validation with appropriate audience checks

### XML Security

XML processing presents specific security concerns:

1. **XXE Attacks**: Disable external entity processing
2. **XML Bombs**: Implement entity expansion limits
3. **Sanitization**: Properly escape and validate all XML input/output

## Performance Considerations

1. **Cold Starts**: Workers have minimal cold start time, but optimize initialization
2. **XML Processing**: Consider streaming approaches for large XML payloads
3. **Caching**: Use Durable Objects to cache frequent requests
4. **Bundle Size**: Keep dependencies minimal
5. **Memory Usage**: Be mindful of the 128MB limit per invocation
6. **Request Limits**: Cloudflare Workers has the following limits to consider:
   - CPU time: Maximum of 30ms on free plans, 50ms on Bundled plans, 30s on Unbound plans
   - Memory: 128MB per invocation
   - Requests: Rate limiting varies by plan (100k/day on free plans)
   - Durable Objects: Storage limits and operation counts
   - Subrequests: Limited to 50 per request on most plans

### Optimization Strategies

1. **Minimize External Calls**: Batch API requests when possible
2. **Implement Strategic Caching**:
   - Cache calendar data with appropriate TTL values
   - Use ETag headers for validation
3. **Use Web Optimized Formats**:
   - Consider JSON alternatives to XML when possible
   - Compress responses with appropriate encoding

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