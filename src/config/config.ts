import { config } from 'dotenv';

// Load environment variables from .env file
config();

export interface ServerConfig {
  port: number;
  serverName: string;
  serverVersion: string;
  environment: string;
  keepAliveInterval: number; // Added keep-alive interval
}

export interface NextcloudConfig {
  baseUrl: string;
  username: string;
  appToken: string;
}

const defaultConfig: ServerConfig = {
  port: 3001,
  serverName: 'nextcloud-calendar-server',
  serverVersion: '1.0.0',
  environment: 'development',
  keepAliveInterval: 30000, // Default: 30 seconds
};

/**
 * Validates that required environment variables are present
 * @returns An object with validation results
 */
export function validateEnvironmentVariables(): {
  isValid: boolean;
  missing: string[];
  serverReady: boolean;
  calendarReady: boolean;
} {
  const missing: string[] = [];

  // Check basic server environment variables (optional but recommended)
  const serverVars = ['PORT', 'SERVER_NAME', 'SERVER_VERSION', 'NODE_ENV'];

  // Check Nextcloud environment variables (required for calendar functionality)
  const nextcloudVars = ['NEXTCLOUD_BASE_URL', 'NEXTCLOUD_USERNAME', 'NEXTCLOUD_APP_TOKEN'];

  // Check for missing variables
  [...serverVars, ...nextcloudVars].forEach((varName) => {
    if (!process.env[varName]) {
      missing.push(varName);
    }
  });

  // Check if any Nextcloud vars are missing
  const missingNextcloud = nextcloudVars.filter((varName) => !process.env[varName]);
  const missingServer = serverVars.filter((varName) => !process.env[varName]);

  // The server can function without Nextcloud config, but calendar service won't be available
  const calendarReady = missingNextcloud.length === 0;

  // Server can start with defaults for server vars, but should warn
  const serverReady = missingServer.length < serverVars.length;

  // Only valid if at least one feature is available (either basic server or calendar)
  const isValid = serverReady || missing.length < serverVars.length + nextcloudVars.length;

  return {
    isValid,
    missing,
    serverReady,
    calendarReady,
  };
}

export function loadConfig(): { server: ServerConfig; nextcloud: NextcloudConfig } {
  // Check command line args for port override
  const args = process.argv.slice(2);
  let portOverride: number | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      const portValue = parseInt(args[i + 1]);
      if (!isNaN(portValue)) {
        portOverride = portValue;
      }
    }
  }

  // Get and validate the Nextcloud environment variables
  const nextcloudBaseUrl = process.env.NEXTCLOUD_BASE_URL || '';
  const nextcloudUsername = process.env.NEXTCLOUD_USERNAME || '';
  const nextcloudAppToken = process.env.NEXTCLOUD_APP_TOKEN || '';

  // Trim trailing slashes from base URL to ensure consistent format
  const formattedBaseUrl = nextcloudBaseUrl.replace(/\/+$/, '');

  return {
    server: {
      port: portOverride || parseInt(process.env.PORT || String(defaultConfig.port)),
      serverName: process.env.SERVER_NAME || defaultConfig.serverName,
      serverVersion: process.env.SERVER_VERSION || defaultConfig.serverVersion,
      environment: process.env.NODE_ENV || defaultConfig.environment,
      keepAliveInterval: process.env.KEEP_ALIVE_INTERVAL
        ? parseInt(process.env.KEEP_ALIVE_INTERVAL)
        : defaultConfig.keepAliveInterval,
    },
    nextcloud: {
      baseUrl: formattedBaseUrl,
      username: nextcloudUsername,
      appToken: nextcloudAppToken,
    },
  };
}
