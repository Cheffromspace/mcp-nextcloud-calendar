# MCP Tools Migration

This document covers migrating MCP tools from Express.js to Cloudflare Workers format.

## MCP Protocol March 2025 Specification Updates

The latest MCP Protocol specification (March 2025) includes several important changes to account for in the migration:

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

## Migration Approach

### Express.js MCP Server (Current)

```typescript
// Current implementation in Express.js
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

### Cloudflare Workers MCP (Target)

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
    // Create new session ID
    const sessionId = crypto.randomUUID();
    
    // Set up SSE stream
    const stream = new ReadableStream({
      start(controller) {
        // Send initial connection message
        const message = `data: ${JSON.stringify({
          type: "connection_established",
          session_id: sessionId
        })}\n\n`;
        
        controller.enqueue(new TextEncoder().encode(message));
      }
    });
    
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Session-ID": sessionId
      }
    });
  }
  
  private async handleMessage(request: Request): Promise<Response> {
    // Implementation for message handling...
    const message = await request.json();
    const sessionId = request.headers.get("X-Session-ID");
    
    // Process the message based on the MCP protocol
    const result = await this.processMessage(message, sessionId);
    
    return new Response(JSON.stringify(result), {
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": sessionId || ""
      }
    });
  }
  
  private async handleSessionTermination(request: Request): Promise<Response> {
    // Implementation for session termination...
    const sessionId = request.headers.get("X-Session-ID");
    
    if (sessionId) {
      // Clean up session data
      const id = this.sessions.idFromName(sessionId);
      const sessionObj = this.sessions.get(id);
      await sessionObj.fetch(new Request("https://session/", {
        method: "DELETE"
      }));
    }
    
    return new Response(JSON.stringify({ success: true }), {
      headers: {
        "Content-Type": "application/json"
      }
    });
  }
}
```

## Migrating MCP Tools

### Step 1: Define Types

First, define the types needed for your MCP tools:

```typescript
// src/types/mcp.ts
export interface ProgressUpdate {
  status: 'in_progress' | 'complete' | 'error';
  message: string;
  progress: number; // 0-1 value representing progress percentage
}

export type ProgressCallback = (update: ProgressUpdate) => void;

export interface Calendar {
  id: string;
  displayName: string;
  color?: string;
  // Other calendar properties
}

export interface McpToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  context?: Record<string, unknown>;
  isError?: boolean;
}
```

### Step 2: Converting Individual Tools

Migrate each MCP tool to the Workers method format:

#### Example: List Calendars

```typescript
/**
 * Lists all calendars
 * @return List of calendars
 */
async listCalendars() {
  try {
    const calendarService = new CalendarService(this.env);
    const calendars = await calendarService.getCalendars();
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, calendars }, null, 2)
        }
      ]
    };
  } catch (error) {
    return this.handleError('retrieve calendars', error);
  }
}
```

#### Example: Create Calendar

```typescript
/**
 * Creates a new calendar
 * @param displayName The calendar display name
 * @param color Optional color for the calendar
 * @return The created calendar
 */
async createCalendar(displayName: string, color?: string) {
  try {
    const calendarService = new CalendarService(this.env);
    
    const calendar = await calendarService.createCalendar({
      displayName,
      color: color || '#0082c9'
    });
    
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ success: true, calendar }, null, 2)
        }
      ]
    };
  } catch (error) {
    return this.handleError('create calendar', error);
  }
}
```

### Step 3: Implement the ProxyToSelf Handler

Implement the `fetch` method to handle HTTP requests:

```typescript
async fetch(request: Request): Promise<Response> {
  // Implement MCP protocol handling for the unified endpoint
  const url = new URL(request.url);
  
  if (url.pathname === "/mcp") {
    // Support the streamable HTTP transport
    if (request.method === "GET") {
      return this.handleSseStream(request);
    } else if (request.method === "POST") {
      return this.handleMcpMessage(request);
    } else if (request.method === "DELETE") {
      return this.handleSessionTermination(request);
    }
  }
  
  // Legacy endpoints for backward compatibility
  if (url.pathname === "/sse") {
    return this.handleLegacySseStream(request);
  } else if (url.pathname === "/messages") {
    return this.handleLegacyMessage(request);
  }
  
  // Default to ProxyToSelf for standard MCP operation
  return new ProxyToSelf(this).fetch(request);
}
```

## Testing MCP Tools

Create tests for your MCP tools:

```typescript
import { describe, test, expect, vi } from 'vitest';
import { unstable_dev } from 'wrangler';

describe('MCP Calendar Tools', () => {
  test('listCalendars should return a list of calendars', async () => {
    const worker = await unstable_dev('src/index.ts', {
      experimental: { disableExperimentalWarning: true }
    });
    
    const resp = await worker.fetch('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'tool_call',
        tool_name: 'listCalendars',
        tool_args: {}
      })
    });
    
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toHaveProperty('content');
    
    await worker.stop();
  });
});
```

## Next Steps

Once you have migrated your MCP tools, proceed to adapt the XML processing as described in [XML Processing](./04-xml-processing.md).