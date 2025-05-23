import express from 'express';
type Request = express.Request;
type Response = express.Response;
type RequestHandler = express.RequestHandler;
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { v4 as uuidv4 } from 'uuid';
// Import Node.js globals explicitly for ESLint
import { setInterval, clearInterval } from 'node:timers';
// Import config for keep-alive settings
import { loadConfig } from '../config/config.js';

/**
 * Model Context Protocol Transport Implementation
 *
 * This file implements both:
 * 1. Latest MCP Streamable HTTP transport specification (March 2025)
 * 2. Legacy HTTP+SSE transport for backward compatibility
 *
 * The Streamable HTTP transport:
 * - Uses a single endpoint (/mcp) for both SSE streams and client messages
 * - Provides proper session management with Mcp-Session-Id headers
 * - Supports GET, POST, and DELETE methods at a single endpoint
 *
 * Legacy HTTP+SSE transport (for backward compatibility):
 * - Uses separate endpoints for SSE streams (/sse) and messages (/messages)
 * - Maintains the older protocol for clients that don't support Streamable HTTP
 *
 * Implementation:
 * Modern Streamable HTTP:
 * 1. GET /mcp - Initializes an SSE stream for server-to-client communication
 * 2. POST /mcp - Handles client-to-server messages with session management
 * 3. DELETE /mcp - Terminates a session when a client is done
 *
 * Legacy HTTP+SSE:
 * 1. GET /sse - Establishes SSE connection
 * 2. POST /messages?sessionId=X - Sends messages to server
 */

// Store transports by session ID
const transports: { [sessionId: string]: SSEServerTransport } = {};

// Global map to track keep-alive interval timers
const keepAliveTimers: { [sessionId: string]: ReturnType<typeof setInterval> } = {};

// Function to clean up all resources (for testing)
export function cleanupAllResources() {
  // Stop all keep-alive timers
  Object.keys(keepAliveTimers).forEach((sessionId) => {
    clearInterval(keepAliveTimers[sessionId]);
    delete keepAliveTimers[sessionId];
  });

  // Clear all transports
  Object.keys(transports).forEach((sessionId) => {
    delete transports[sessionId];
  });
}

// Get keep-alive interval from config
const config = loadConfig();
const KEEP_ALIVE_INTERVAL = config.server.keepAliveInterval;

/**
 * Starts a keep-alive pinger for a specific session
 * @param sessionId The session ID to track
 * @param res The Express response object to write keep-alive events to
 */
function startKeepAlivePinger(sessionId: string, res: Response): void {
  // Clear existing timer if there is one
  if (keepAliveTimers[sessionId]) {
    clearInterval(keepAliveTimers[sessionId]);
    console.log(`Cleared existing keep-alive timer for session ${sessionId}`);
  }

  // Create a new keep-alive interval
  keepAliveTimers[sessionId] = setInterval(() => {
    try {
      if (transports[sessionId]) {
        res.write('event: ping\ndata: keep-alive\n\n');
        console.log(`Sent keep-alive ping for session ${sessionId}`);
      } else {
        stopKeepAlivePinger(sessionId);
      }
    } catch (error) {
      console.error(`Error sending keep-alive ping for session ${sessionId}:`, error);
      stopKeepAlivePinger(sessionId);
    }
  }, KEEP_ALIVE_INTERVAL);

  console.log(
    `Started keep-alive pinger for session ${sessionId} (interval: ${KEEP_ALIVE_INTERVAL}ms)`,
  );
}

/**
 * Stops a keep-alive pinger for a specific session
 * @param sessionId The session ID to stop pinging
 */
function stopKeepAlivePinger(sessionId: string): void {
  if (keepAliveTimers[sessionId]) {
    clearInterval(keepAliveTimers[sessionId]);
    delete keepAliveTimers[sessionId];
    console.log(`Stopped keep-alive pinger for session ${sessionId}`);
  }
}

/**
 * Cleans up resources when a session is closed
 * @param sessionId The session ID to clean up
 */
function cleanupSession(sessionId: string): void {
  console.log(`Cleaning up session ${sessionId}`);

  // Stop keep-alive pinger
  stopKeepAlivePinger(sessionId);

  // Remove transport
  if (transports[sessionId]) {
    delete transports[sessionId];
    console.log(`Removed transport for session ${sessionId}`);
  }

  console.log(`Active sessions after cleanup: ${Object.keys(transports).length}`);
}

// Streamable HTTP transport handlers
export function setupMcpTransport(server: McpServer) {
  // Unified MCP endpoint - handles both GET for SSE and POST for messages
  // Implements the Streamable HTTP transport (latest spec)
  const mcpHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    console.log(
      `MCP ${req.method} request received, session ID: ${req.headers['mcp-session-id'] || 'none'}`,
    );
    console.log(
      `Active sessions: ${Object.keys(transports).length} [${Object.keys(transports).join(', ')}]`,
    );
    // For DELETE requests - terminate session if it exists
    if (req.method === 'DELETE') {
      const sessionId = req.headers['mcp-session-id'] as string;
      if (sessionId && transports[sessionId]) {
        cleanupSession(sessionId);
        res.status(202).end();
        return;
      }
      res.status(404).end();
      return;
    }

    // For GET requests - initialize SSE stream
    if (req.method === 'GET') {
      console.log('Streamable HTTP GET request received (SSE stream)');

      // Set appropriate headers for SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');

      try {
        // Create a new SSE transport for the Streamable HTTP endpoint
        const transport = new SSEServerTransport('/mcp', res);

        // Use provided session ID if exists, otherwise use transport's generated one
        const sessionId = (req.headers['mcp-session-id'] as string) || transport.sessionId;
        console.log(`Streamable HTTP SSE transport created with sessionId: ${sessionId}`);

        // Store transport with session ID
        transports[sessionId] = transport;
        console.log(
          `Active sessions: ${Object.keys(transports).length} [${Object.keys(transports).join(', ')}]`,
        );

        // Add session ID header if not provided by client
        if (!req.headers['mcp-session-id']) {
          res.setHeader('Mcp-Session-Id', sessionId);
          console.log(`Added Mcp-Session-Id header: ${sessionId}`);
        }

        // Add a close event handler
        res.on('close', () => {
          console.log(`Streamable HTTP SSE connection closed for sessionId: ${sessionId}`);
          cleanupSession(sessionId);
        });

        // Connect to the MCP server - this will start the transport automatically
        await server.connect(transport);
        console.log(`Streamable HTTP SSE transport connected to MCP server`);

        // Start keep-alive pinger
        startKeepAlivePinger(sessionId, res);
      } catch (error) {
        console.error('Error establishing Streamable HTTP SSE connection:', error);
        if (!res.headersSent) {
          res.status(500).end('Error establishing SSE connection');
        } else {
          res.end();
        }
      }
      return;
    }

    // For POST requests - handle client messages
    if (req.method === 'POST') {
      const sessionId = req.headers['mcp-session-id'] as string;

      // If we have a session ID and an associated transport, handle the message
      if (sessionId && transports[sessionId]) {
        const transport = transports[sessionId];
        try {
          console.log(`Processing message for session ${sessionId}`);

          // Pass parsed body to handlePostMessage to avoid it trying to parse the body again
          await transport.handlePostMessage(req, res, req.body);
          return;
        } catch (error) {
          console.error(`Error handling message for session ${sessionId}:`, error);

          // Only set status if headers haven't been sent yet
          if (!res.headersSent) {
            res.status(500).json({
              error: 'Error processing message',
              message: error instanceof Error ? error.message : String(error),
            });
          }
          return;
        }
      }

      // If no session ID or no transport found with that ID,
      // this might be an initialization request
      if (!sessionId || !transports[sessionId]) {
        // Generate a new session ID if not provided
        const newSessionId = sessionId || uuidv4();

        // If this is an initialization request, create a new transport
        // Note: We're handling this differently than regular messages
        // as there's no existing transport yet

        // Set the session ID header for the response
        res.setHeader('Mcp-Session-Id', newSessionId);

        // Process the initialization request
        // For now, we'll just accept it with a 202 status
        res.status(202).end();
        return;
      }

      // If we reach here, session ID was provided but no transport exists
      res.status(404).json({
        error: 'Session not found',
        code: -32001,
        message: 'No session found with the provided ID',
      });
      return;
    }

    // Method not allowed for other HTTP methods
    res.status(405).end();
    return;
  };

  // Legacy SSE endpoint handler (for backward compatibility)
  const sseHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    console.log('Legacy SSE connection request received');

    // Set appropriate headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    try {
      // Create a new SSE transport with the legacy endpoint
      const transport = new SSEServerTransport('/messages', res);
      const sessionId = transport.sessionId;
      console.log(`Legacy SSE transport created with sessionId: ${sessionId}`);

      // Store the transport by session ID
      transports[sessionId] = transport;
      console.log(
        `Active sessions: ${Object.keys(transports).length} [${Object.keys(transports).join(', ')}]`,
      );

      // Add a close event handler to clean up resources when the connection closes
      res.on('close', () => {
        console.log(`Legacy SSE connection closed for sessionId: ${sessionId}`);
        cleanupSession(sessionId);
      });

      // Connect to the MCP server - this will start the transport automatically
      await server.connect(transport);
      console.log(`Legacy SSE transport connected to MCP server`);

      // Start keep-alive pinger
      startKeepAlivePinger(sessionId, res);
    } catch (error) {
      console.error('Error establishing SSE connection:', error);
      res.end();
    }
  };

  // Legacy message handling endpoint (for backward compatibility)
  const messageHandler: RequestHandler = async (req: Request, res: Response): Promise<void> => {
    const sessionId = req.query.sessionId as string;
    console.log(`Legacy message POST received, query sessionId: ${sessionId || 'none'}`);
    console.log(
      `Active sessions: ${Object.keys(transports).length} [${Object.keys(transports).join(', ')}]`,
    );

    if (!sessionId) {
      console.error('No session ID provided in request URL');
      res.status(400).json({ error: 'Missing sessionId parameter' });
      return;
    }

    const transport = transports[sessionId];

    if (!transport) {
      console.warn(`No transport found for sessionId ${sessionId}`);
      res.status(404).json({ error: 'No transport found for sessionId' });
      return;
    }

    try {
      console.log(`Processing legacy message for session ${sessionId}`);

      // Pass parsed body to handlePostMessage to avoid it trying to parse the body again
      await transport.handlePostMessage(req, res, req.body);
    } catch (error) {
      console.error(`Error handling legacy message for session ${sessionId}:`, error);

      // Only set status if headers haven't been sent yet
      if (!res.headersSent) {
        res.status(500).json({
          error: 'Error processing message',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  return {
    mcpHandler, // Streamable HTTP handler
    sseHandler, // Legacy SSE handler
    messageHandler, // Legacy message handler
    transports,
    keepAliveTimers, // Export timers for testing and debugging
  };
}
