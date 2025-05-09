/**
 * Logger utility for consistent logging throughout the application
 * Provides different log levels and context-aware logging
 */

// Log levels
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

// Environment-based log level
const ENV_LOG_LEVEL = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
const DEFAULT_LOG_LEVEL = LogLevel[ENV_LOG_LEVEL as keyof typeof LogLevel] || LogLevel.INFO;

// Color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

/**
 * Logger class for enhanced logging capabilities
 */
export class Logger {
  private context: string;
  private logLevel: LogLevel;

  /**
   * Creates a new logger instance
   * @param context Context name for this logger
   * @param logLevel Optional override for log level
   */
  constructor(context: string, logLevel?: LogLevel) {
    this.context = context;
    this.logLevel = logLevel !== undefined ? logLevel : DEFAULT_LOG_LEVEL;
  }

  /**
   * Format a log message with timestamp, context and level
   */
  private formatMessage(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `${timestamp} [${this.context}] ${level}: ${message}`;
  }

  /**
   * Masks sensitive information in objects before logging
   * @param data Object containing potentially sensitive information
   * @returns Object with sensitive fields masked
   */
  static maskSensitiveData<T>(data: T): T {
    if (!data || typeof data !== 'object') {
      return data;
    }

    // Define sensitive fields to mask, add more as needed
    const sensitiveFields = [
      'password',
      'token',
      'secret',
      'key',
      'auth',
      'credentials',
      'appToken',
      'app_token',
      'authorization',
      'apiKey',
      'api_key',
    ];

    // Create a copy to avoid modifying the original
    const maskedData = { ...(data as object) } as Record<string, unknown>;

    // Recursively mask sensitive data
    for (const [key, value] of Object.entries(maskedData)) {
      // Check if the key is sensitive
      const isSensitive = sensitiveFields.some((field) =>
        key.toLowerCase().includes(field.toLowerCase()),
      );

      if (isSensitive && value) {
        // Mask the sensitive value - preserve the first and last character
        if (typeof value === 'string' && value.length > 4) {
          maskedData[key] = `${value.substring(0, 1)}***${value.substring(value.length - 1)}`;
        } else {
          maskedData[key] = '***';
        }
      } else if (value && typeof value === 'object') {
        // Recursively mask nested objects
        maskedData[key] = Logger.maskSensitiveData(value);
      }
    }

    return maskedData as T;
  }

  /**
   * Debug level logging, usually only enabled in development
   * Automatically masks sensitive information in parameters
   */
  debug(message: string, ...optionalParams: unknown[]): void {
    if (this.logLevel <= LogLevel.DEBUG) {
      // Mask sensitive information in the optional parameters
      const maskedParams = optionalParams.map((param) =>
        typeof param === 'object' ? Logger.maskSensitiveData(param) : param,
      );

      console.log(
        COLORS.gray + this.formatMessage('DEBUG', message) + COLORS.reset,
        ...maskedParams,
      );
    }
  }

  /**
   * Info level logging for general application information
   * Automatically masks sensitive information in parameters
   */
  info(message: string, ...optionalParams: unknown[]): void {
    if (this.logLevel <= LogLevel.INFO) {
      // Mask sensitive information in the optional parameters
      const maskedParams = optionalParams.map((param) =>
        typeof param === 'object' ? Logger.maskSensitiveData(param) : param,
      );

      console.log(
        COLORS.green + this.formatMessage('INFO', message) + COLORS.reset,
        ...maskedParams,
      );
    }
  }

  /**
   * Warning level logging for potential issues that don't block execution
   * Automatically masks sensitive information in parameters
   */
  warn(message: string, ...optionalParams: unknown[]): void {
    if (this.logLevel <= LogLevel.WARN) {
      // Mask sensitive information in the optional parameters
      const maskedParams = optionalParams.map((param) =>
        typeof param === 'object' ? Logger.maskSensitiveData(param) : param,
      );

      console.warn(
        COLORS.yellow + this.formatMessage('WARN', message) + COLORS.reset,
        ...maskedParams,
      );
    }
  }

  /**
   * Error level logging for actual errors that might affect functionality
   * Automatically masks sensitive information in parameters
   */
  error(message: string, ...optionalParams: unknown[]): void {
    if (this.logLevel <= LogLevel.ERROR) {
      // Mask sensitive information in the optional parameters
      const maskedParams = optionalParams.map((param) =>
        typeof param === 'object' ? Logger.maskSensitiveData(param) : param,
      );

      console.error(
        COLORS.red + this.formatMessage('ERROR', message) + COLORS.reset,
        ...maskedParams,
      );
    }
  }

  /**
   * Creates a child logger with a sub-context
   * @param subContext The sub-context name
   * @returns A new logger with the combined context
   */
  createChildLogger(subContext: string): Logger {
    return new Logger(`${this.context}:${subContext}`, this.logLevel);
  }
}

/**
 * Creates a logger instance for a specific context
 * @param context The context identifier for the logger
 * @returns Logger instance
 */
export function createLogger(context: string): Logger {
  return new Logger(context);
}
