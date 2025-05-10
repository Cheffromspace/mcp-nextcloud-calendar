// src/types/mcp.ts

/**
 * Interface for progress updates during streaming operations
 */
export interface ProgressUpdate {
  status: 'in_progress' | 'complete' | 'error';
  message: string;
  progress: number; // 0-1 value representing progress percentage
}

/**
 * Callback for receiving progress updates
 */
export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Standard response format for MCP tools
 */
export interface McpToolResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  context?: Record<string, unknown>;
  isError?: boolean;
}