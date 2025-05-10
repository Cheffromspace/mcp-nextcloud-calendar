// src/config.ts
import type { Env } from './types/env';

/**
 * Nextcloud configuration
 */
export interface NextcloudConfig {
  baseUrl: string;
  username: string;
  appToken: string;
}

/**
 * Server configuration
 */
export interface ServerConfig {
  serverName: string;
  serverVersion: string;
  environment: string;
  debugMode: boolean;
}

/**
 * Loads Nextcloud configuration from environment
 */
export function loadNextcloudConfig(env: Env): NextcloudConfig {
  return {
    baseUrl: env.NEXTCLOUD_BASE_URL,
    username: env.NEXTCLOUD_USERNAME,
    appToken: env.NEXTCLOUD_APP_TOKEN
  };
}

/**
 * Loads server configuration from environment
 */
export function loadServerConfig(env: Env): ServerConfig {
  return {
    serverName: 'MCP Nextcloud Calendar',
    serverVersion: '1.0.0',
    environment: env.ENVIRONMENT || 'development',
    debugMode: env.DEBUG_MODE === 'true'
  };
}

/**
 * Validates environment variables are present
 */
export function validateConfig(env: Env): {
  isValid: boolean;
  serverReady: boolean;
  calendarReady: boolean;
  missing: string[];
} {
  const required = ['NEXTCLOUD_BASE_URL', 'NEXTCLOUD_USERNAME', 'NEXTCLOUD_APP_TOKEN'];
  
  const missing = required.filter(key => !env[key as keyof Env]);
  const calendarReady = missing.length === 0;
  
  // Server can run with minimal functionality even without calendar config
  const serverReady = true;
  
  return {
    isValid: true,  // We always return valid as Workers may have defaults set
    serverReady,
    calendarReady,
    missing
  };
}