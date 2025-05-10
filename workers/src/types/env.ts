// src/types/env.ts
import type { DurableObjectNamespace } from '@cloudflare/workers-types';

/**
 * Environment configuration for the Worker
 */
export interface Env {
  // Secrets
  NEXTCLOUD_BASE_URL: string;
  NEXTCLOUD_USERNAME: string;
  NEXTCLOUD_APP_TOKEN: string;

  // Environment variables
  ENVIRONMENT?: string;
  DEBUG_MODE?: string;

  // Durable Objects
  SESSIONS: DurableObjectNamespace;
  CALENDARS: DurableObjectNamespace;
}