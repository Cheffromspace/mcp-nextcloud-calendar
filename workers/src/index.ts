// src/index.ts
import type { Env } from "./types/env";
import type { ExecutionContext } from "@cloudflare/workers-types";
// Import Session Store and Calendar Cache for Durable Object exports only
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { SessionStore } from "./durable-objects/session-store";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { CalendarCache } from "./durable-objects/calendar-cache";

/**
 * Main Worker class for Nextcloud Calendar MCP
 */
export default {
  /**
   * Handles fetch requests to the Worker
   */
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const worker = new CalendarWorker(env);
    return worker.fetch(request);
  }
};

/**
 * Calendar Worker implementation class
 */
class CalendarWorker {
  private env: Env;

  /**
   * Constructor for the Worker
   */
  constructor(env: Env) {
    this.env = env;
  }

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
   * Lists all available calendars
   * @return The calendars from Nextcloud
   */
  async listCalendars() {
    try {
      // This is a placeholder that will be implemented later
      // when we migrate the calendar service
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              calendars: [],
              message: "Calendar service not yet implemented"
            }, null, 2)
          }
        ]
      };
    } catch (error) {
      return this.handleCalendarToolError('retrieve calendars', error);
    }
  }

  /**
   * Handles errors for calendar operations
   * @param operation The operation being performed
   * @param error The error that occurred
   * @returns Formatted error response
   */
  private handleCalendarToolError(operation: string, error: unknown) {
    console.error(`Error in ${operation} tool:`, error);

    const message = error instanceof Error ? error.message : 'Unknown error';

    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: `Failed to ${operation}: ${message}`,
        },
      ],
    };
  }

  /**
   * Entry point for the Worker
   */
  async fetch(request: Request): Promise<Response> {
    // Handle the health check endpoint
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      const healthResponse = await this.getHealth();
      return new Response(
        healthResponse.content[0].text,
        {
          status: 200,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    // Handle MCP operations based on the request
    // In a full implementation, we'd handle MCP protocol here
    return new Response(JSON.stringify({
      error: "MCP protocol handler not yet implemented"
    }), {
      status: 501,
      headers: { "Content-Type": "application/json" }
    });
  }
}

// Export Durable Objects
export { SessionStore } from "./durable-objects/session-store";
export { CalendarCache } from "./durable-objects/calendar-cache";