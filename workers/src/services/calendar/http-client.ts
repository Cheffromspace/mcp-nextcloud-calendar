// src/services/calendar/http-client.ts
import type { NextcloudConfig } from '../../config';

/**
 * HTTP client for NextCloud API using fetch
 */
export class HttpClient {
  private baseUrl: string;
  private authHeader: string;

  /**
   * Constructor
   */
  constructor(config: NextcloudConfig) {
    this.baseUrl = config.baseUrl;
    // In a worker environment, we need to use the global btoa function
    // which is available in the Workers runtime
    this.authHeader = 'Basic ' + globalThis.btoa(`${config.username}:${config.appToken}`);
  }

  /**
   * Performs a PROPFIND request
   */
  async propfind(url: string, depth: number, data: string): Promise<Response> {
    try {
      const response = await globalThis.fetch(url, {
        method: 'PROPFIND',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': depth.toString(),
          'Authorization': this.authHeader
        },
        body: data
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error('PROPFIND request failed:', error);
      throw error;
    }
  }

  /**
   * Performs a REPORT request
   */
  async report(url: string, depth: number, data: string): Promise<Response> {
    try {
      const response = await globalThis.fetch(url, {
        method: 'REPORT',
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Depth': depth.toString(),
          'Authorization': this.authHeader
        },
        body: data
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error('REPORT request failed:', error);
      throw error;
    }
  }

  /**
   * Performs a GET request
   */
  async get(url: string): Promise<Response> {
    try {
      const response = await globalThis.fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error('GET request failed:', error);
      throw error;
    }
  }

  /**
   * Performs a PUT request
   */
  async put(url: string, data: string, contentType = 'application/xml'): Promise<Response> {
    try {
      const response = await globalThis.fetch(url, {
        method: 'PUT',
        headers: {
          'Content-Type': contentType,
          'Authorization': this.authHeader
        },
        body: data
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error('PUT request failed:', error);
      throw error;
    }
  }

  /**
   * Performs a DELETE request
   */
  async delete(url: string): Promise<Response> {
    try {
      const response = await globalThis.fetch(url, {
        method: 'DELETE',
        headers: {
          'Authorization': this.authHeader
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP Error: ${response.status} - ${response.statusText}`);
      }

      return response;
    } catch (error) {
      console.error('DELETE request failed:', error);
      throw error;
    }
  }

  /**
   * Converts Response to axios-like format for compatibility
   */
  async processResponse(response: Response): Promise<{
    data: string;
    status: number;
    statusText: string;
    headers: Record<string, string>;
  }> {
    const data = await response.text();

    // Convert Headers to a plain object
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      data,
      status: response.status,
      statusText: response.statusText,
      headers
    };
  }
}