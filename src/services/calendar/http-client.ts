/**
 * HTTP client for interacting with Nextcloud CalDAV API
 */
import axios from 'axios';
import { createLogger } from '../logger.js';

const logger = createLogger('CalendarHttpClient');

export class CalendarHttpClient {
  private authHeader: string;
  private baseUrl: string;
  private caldavUrl: string;

  constructor(baseUrl: string, username: string, appToken: string) {
    this.baseUrl = baseUrl;
    this.caldavUrl = `${baseUrl}/remote.php/dav/calendars/${username}/`;

    // Create Basic Auth header
    // Use global Buffer (available in Node.js)
    // eslint-disable-next-line no-undef
    const auth = Buffer.from(`${username}:${appToken}`).toString('base64');
    this.authHeader = `Basic ${auth}`;
  }

  /**
   * Get the CalDAV URL for the user
   */
  getCalDavUrl(): string {
    return this.caldavUrl;
  }

  /**
   * Get the base URL for the Nextcloud server
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Make a PROPFIND request to get calendar properties
   * @param data XML data for the request
   * @param depth Depth of the request (0, 1, or infinity)
   * @returns The response data
   */
  async propfind(data: string, depth: string = '1'): Promise<string> {
    try {
      logger.debug('Making PROPFIND request to Nextcloud CalDAV');

      const response = await axios({
        method: 'PROPFIND',
        url: this.caldavUrl,
        headers: {
          Authorization: this.authHeader,
          Depth: depth,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data,
      });

      return response.data;
    } catch (error) {
      logger.error('PROPFIND request failed:', error);
      throw this.handleHttpError(error, 'Failed to fetch calendar data');
    }
  }

  /**
   * Make a MKCALENDAR request to create a new calendar
   * @param calendarId The ID for the new calendar
   * @param data XML data for the request
   * @returns The response data
   */
  async mkcalendar(calendarId: string, data: string): Promise<void> {
    try {
      const calendarUrl = this.caldavUrl + calendarId + '/';
      logger.debug(`Making MKCALENDAR request for calendar ${calendarId}`);

      await axios({
        method: 'MKCALENDAR',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data,
      });
    } catch (error) {
      logger.error(`MKCALENDAR request failed for ${calendarId}:`, error);
      throw this.handleHttpError(error, 'Failed to create calendar');
    }
  }

  /**
   * Make a PROPPATCH request to update calendar properties
   * @param calendarId The ID of the calendar to update
   * @param data XML data for the request
   * @returns The response data
   */
  async proppatch(calendarId: string, data: string): Promise<void> {
    try {
      const calendarUrl = this.caldavUrl + calendarId + '/';
      logger.debug(`Making PROPPATCH request for calendar ${calendarId}`);

      await axios({
        method: 'PROPPATCH',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data,
      });
    } catch (error) {
      logger.error(`PROPPATCH request failed for ${calendarId}:`, error);
      throw this.handleHttpError(error, 'Failed to update calendar properties');
    }
  }

  /**
   * Make a DELETE request to delete a calendar
   * @param calendarId The ID of the calendar to delete
   */
  async deleteCalendar(calendarId: string): Promise<void> {
    try {
      const calendarUrl = this.caldavUrl + calendarId + '/';
      logger.debug(`Making DELETE request for calendar ${calendarId}`);

      await axios({
        method: 'DELETE',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
        },
      });
    } catch (error) {
      logger.error(`DELETE request failed for ${calendarId}:`, error);
      throw this.handleHttpError(error, 'Failed to delete calendar');
    }
  }

  /**
   * Process HTTP errors and provide meaningful error messages
   * @param error The axios error
   * @param defaultMessage Default error message if specific error cannot be determined
   * @returns Error with meaningful message
   */
  private handleHttpError(error: unknown, defaultMessage: string): Error {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status || 500;

      // Handle common HTTP errors with more specific messages
      if (status === 401 || status === 403) {
        return new Error('Unauthorized: You do not have permission for this action.');
      } else if (status === 404) {
        return new Error('Resource not found.');
      } else if (status === 405) {
        return new Error('Operation not supported by this server.');
      } else if (status === 409) {
        return new Error('Conflict: Resource already exists or contains conflicts.');
      } else if (status === 423) {
        return new Error('Resource is locked and cannot be modified.');
      } else if (status === 507) {
        return new Error('Insufficient storage space.');
      }
    }

    // Generic error for unknown cases
    return new Error(defaultMessage);
  }
}
