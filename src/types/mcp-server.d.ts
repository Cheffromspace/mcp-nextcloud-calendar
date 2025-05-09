/**
 * Type definitions for Model Context Protocol server
 */

declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  interface McpServerOptions {
    name: string;
    version: string;
  }

  interface ToolParameter {
    type: string;
    description: string;
    required?: boolean;
  }

  interface Tool {
    name: string;
    description: string;
    parameters?: Record<string, ToolParameter>;
    execute: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }

  interface McpSession {
    id: string;
    sendMessage(message: Record<string, unknown>): void;
    close(): void;
  }

  // Make the body property optional to accommodate different transport types
  interface McpRequest {
    sessionId?: string;
    session?: McpSession;
    body?: Record<string, unknown>;
  }

  export class McpServer {
    constructor(options: McpServerOptions);

    /**
     * Register a tool with the MCP server
     * @param tool The tool to register
     */
    registerTool(tool: Tool): void;

    /**
     * Connect a new MCP session
     * @param request The MCP request object
     * @returns Promise that resolves with the session ID
     */
    connect(request: McpRequest): Promise<string>;

    /**
     * Close the server
     * @returns Promise that resolves when the server is closed
     */
    close(): Promise<void>;
  }
}
