#!/usr/bin/env node
// Import Express in a way compatible with both ESM and TypeScript
import express from 'express';
// Import the MCP server with now-proper type definitions
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { loadConfig, validateEnvironmentVariables } from './config/config.js';
import { healthHandler } from './handlers/health.js';
import { setupMcpTransport } from './handlers/mcp-transport.js';
import { getCalendarsHandler } from './handlers/calendars.js';
import { CalendarService } from './services/index.js';
import * as os from 'node:os';

// Validate environment variables
const validation = validateEnvironmentVariables();
if (validation.missing.length > 0) {
  console.warn('Some environment variables are missing:');
  validation.missing.forEach((variable) => {
    console.warn(`  - ${variable}`);
  });
}

// Check if we have valid configuration to start the server
if (!validation.isValid) {
  console.error('ERROR: Invalid configuration. Server cannot start.');
  console.error('Please provide the required environment variables and restart the server.');
  process.exit(1);
}

// Load configuration
const config = loadConfig();
const { server: serverConfig, nextcloud: nextcloudConfig } = config;

// Show a clear message about what features are available
if (!validation.serverReady) {
  console.warn('WARNING: Server is running with minimal configuration.');
  console.warn('Some features may not work correctly without proper server configuration.');
}

if (!validation.calendarReady) {
  console.warn('WARNING: Calendar service is disabled due to missing configuration.');
}

// Initialize services
let calendarService: CalendarService | null = null;

// Only try to initialize calendar service if all required environment variables are available
if (validation.calendarReady) {
  try {
    calendarService = new CalendarService(nextcloudConfig);
    console.log('Calendar service initialized successfully');
  } catch (error) {
    console.error('Failed to initialize calendar service:', error);
  }
} else {
  console.warn(
    'Calendar service not initialized due to missing environment variables:',
    ['NEXTCLOUD_BASE_URL', 'NEXTCLOUD_USERNAME', 'NEXTCLOUD_APP_TOKEN']
      .filter((varName) => !process.env[varName])
      .join(', '),
  );
  console.warn('Calendar-related functionality will not be available');
}

// Create MCP server
const server = new McpServer({
  name: serverConfig.serverName,
  version: serverConfig.serverVersion,
});

// Register calendar tools if calendar service is available
if (calendarService) {
  // List calendars tool
  server.registerTool({
    name: 'listCalendars',
    description: 'Get a list of all available calendars',
    execute: async () => {
      try {
        const calendars = await calendarService.getCalendars();
        return { success: true, calendars };
      } catch (error) {
        console.error('Error in listCalendars tool:', error);
        return {
          success: false,
          error: 'Failed to retrieve calendars. Please try again later.',
        };
      }
    },
  });

  // Create calendar tool
  server.registerTool({
    name: 'createCalendar',
    description: 'Create a new calendar',
    parameters: {
      displayName: { type: 'string', description: 'The display name for the calendar' },
      color: {
        type: 'string',
        description: 'The color for the calendar (hex format)',
        required: false,
      },
      category: {
        type: 'string',
        description: 'Visual category or tag for ADHD-friendly organization',
        required: false,
      },
      focusPriority: {
        type: 'number',
        description: 'Priority level for ADHD focus management (1-10)',
        required: false,
      },
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        if (!params.displayName) {
          return { success: false, error: 'Calendar display name is required' };
        }

        const newCalendar = {
          displayName: String(params.displayName),
          color: params.color ? String(params.color) : '#0082c9',
          owner: '', // Will be assigned by service
          isDefault: false,
          isShared: false,
          isReadOnly: false,
          permissions: {
            canRead: true,
            canWrite: true,
            canShare: true,
            canDelete: true,
          },
          category: params.category ? String(params.category) : undefined,
          focusPriority: params.focusPriority ? Number(params.focusPriority) : undefined,
          metadata: null,
        };

        const calendar = await calendarService.createCalendar(newCalendar);
        return { success: true, calendar };
      } catch (error) {
        console.error('Error in createCalendar tool:', error);
        return {
          success: false,
          error: 'Failed to create calendar. Please try again later.',
        };
      }
    },
  });

  // Update calendar tool
  server.registerTool({
    name: 'updateCalendar',
    description: 'Update an existing calendar',
    parameters: {
      id: { type: 'string', description: 'The ID of the calendar to update' },
      displayName: {
        type: 'string',
        description: 'The new display name for the calendar',
        required: false,
      },
      color: {
        type: 'string',
        description: 'The new color for the calendar (hex format)',
        required: false,
      },
      category: {
        type: 'string',
        description: 'Visual category or tag for ADHD-friendly organization',
        required: false,
      },
      focusPriority: {
        type: 'number',
        description: 'Priority level for ADHD focus management (1-10)',
        required: false,
      },
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        if (!params.id) {
          return { success: false, error: 'Calendar ID is required' };
        }

        const id = String(params.id);
        const updates: Record<string, unknown> = {};
        if (params.displayName !== undefined) updates.displayName = String(params.displayName);
        if (params.color !== undefined) updates.color = String(params.color);
        if (params.category !== undefined) updates.category = String(params.category);
        if (params.focusPriority !== undefined)
          updates.focusPriority = Number(params.focusPriority);

        if (Object.keys(updates).length === 0) {
          return { success: false, error: 'No update parameters provided' };
        }

        const calendar = await calendarService.updateCalendar(id, updates);
        return { success: true, calendar };
      } catch (error) {
        console.error('Error in updateCalendar tool:', error);
        return {
          success: false,
          error: 'Failed to update calendar. Please try again later.',
        };
      }
    },
  });

  // Delete calendar tool
  server.registerTool({
    name: 'deleteCalendar',
    description: 'Delete an existing calendar',
    parameters: {
      id: { type: 'string', description: 'The ID of the calendar to delete' },
    },
    execute: async (params: Record<string, unknown>) => {
      try {
        if (!params.id) {
          return { success: false, error: 'Calendar ID is required' };
        }

        const result = await calendarService.deleteCalendar(String(params.id));
        return { success: result };
      } catch (error) {
        console.error('Error in deleteCalendar tool:', error);
        return {
          success: false,
          error: 'Failed to delete calendar. Please try again later.',
        };
      }
    },
  });
}

// Setup Express app
const app = express();
app.use(express.json());

// Setup handlers
const { mcpHandler, sseHandler, messageHandler } = setupMcpTransport(server);

// Configure routes
app.get('/health', healthHandler(serverConfig));

// Modern Streamable HTTP endpoint
app.all('/mcp', mcpHandler);

// Legacy HTTP+SSE transport endpoints (for backward compatibility)
app.get('/sse', sseHandler);
app.post('/messages', messageHandler);

// Calendar routes
app.get('/api/calendars', getCalendarsHandler(calendarService));

// Graceful shutdown handling
const gracefulShutdown = () => {
  console.log('Shutting down gracefully...');
  server
    .close()
    .then(() => {
      console.log('Server closed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Error during shutdown:', err);
      process.exit(1);
    });
};

// Handle termination signals
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Get server's IP address(es)
function getServerIpAddresses(): string[] {
  const nets = os.networkInterfaces();
  const results: string[] = [];

  for (const name of Object.keys(nets)) {
    // Type assertion needed since TypeScript doesn't know the structure
    const interfaces = nets[name];
    if (!interfaces) continue;

    for (const net of interfaces) {
      // Skip internal and non-IPv4 addresses
      if (!net.internal && net.family === 'IPv4') {
        results.push(net.address);
      }
    }
  }

  return results.length ? results : ['localhost'];
}

// Start the server
app.listen(serverConfig.port, () => {
  const ipAddresses = getServerIpAddresses();
  const serverName = serverConfig.serverName;
  const serverVersion = serverConfig.serverVersion;

  console.log('='.repeat(80));
  console.log(`Nextcloud Calendar MCP Server v${serverVersion}`);
  console.log('='.repeat(80));

  console.log(`\nEnvironment: ${serverConfig.environment}`);
  console.log(`Server name: ${serverName}`);

  console.log('\nEndpoints available:');
  console.log('-------------------');

  // Display MCP endpoint information for each IP address
  ipAddresses.forEach((ip) => {
    console.log(`MCP Streamable HTTP: http://${ip}:${serverConfig.port}/mcp`);
    console.log(`  - Supports GET (SSE streams), POST (messages), DELETE (session termination)`);
    console.log(`  - MCP Protocol: March 2025 Specification`);

    console.log(`\nLegacy HTTP+SSE endpoints:`);
    console.log(`  - SSE stream: http://${ip}:${serverConfig.port}/sse`);
    console.log(`  - Messages: http://${ip}:${serverConfig.port}/messages?sessionId=X`);
    console.log(`  - MCP Protocol: 2024-11-05 Specification (backward compatibility)`);
  });

  console.log('\nHealth check endpoint:');
  ipAddresses.forEach((ip) => {
    console.log(`  - http://${ip}:${serverConfig.port}/health`);
  });

  console.log('\nCalendar API endpoint:');
  ipAddresses.forEach((ip) => {
    console.log(`  - http://${ip}:${serverConfig.port}/api/calendars`);
  });

  console.log('\nServer is running and ready to accept connections.');
  console.log('='.repeat(80));
});
