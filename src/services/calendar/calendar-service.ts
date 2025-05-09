/**
 * Calendar Service for interacting with Nextcloud calendars via CalDAV
 */
import { NextcloudConfig } from '../../config/config.js';
import { Calendar, CalendarUtils } from '../../models/index.js';
import { createLogger } from '../logger.js';
import { CalendarHttpClient } from './http-client.js';
import * as PropertyParser from './property-parser.js';
import * as XmlUtils from './xml-utils.js';

export class CalendarService {
  private config: NextcloudConfig;
  private httpClient: CalendarHttpClient;
  private logger = createLogger('CalendarService');

  constructor(config: NextcloudConfig) {
    this.config = config;

    if (!this.config.baseUrl || !this.config.username || !this.config.appToken) {
      throw new Error('Nextcloud configuration is incomplete');
    }

    // Remove trailing slash if present
    const baseUrl = this.config.baseUrl.replace(/\/$/, '');

    // Initialize HTTP client
    this.httpClient = new CalendarHttpClient(baseUrl, this.config.username, this.config.appToken);

    // Log initialization without sensitive details
    this.logger.info('CalendarService initialized successfully', {
      baseUrl: baseUrl,
      username: this.config.username,
    });
  }

  /**
   * Get a list of all calendars for the user
   * @returns Promise<Calendar[]> List of calendars
   */
  async getCalendars(): Promise<Calendar[]> {
    try {
      // Make request to Nextcloud CalDAV endpoint with PROPFIND
      const xmlResponse = await this.httpClient.propfind(XmlUtils.buildCalendarPropertiesRequest());

      // Parse XML response
      const xmlData = await XmlUtils.parseXmlResponse(xmlResponse);

      // Extract calendar information
      const calendars: Calendar[] = [];

      const multistatus = XmlUtils.getMultistatus(xmlData);
      if (multistatus) {
        const responses = XmlUtils.getResponses(multistatus);

        // Process each response
        for (const response of responses) {
          try {
            const calendar = PropertyParser.parseCalendarResponse(
              response,
              this.httpClient.getBaseUrl(),
              this.httpClient.getCalDavUrl(),
              this.config.username,
            );
            if (calendar) {
              calendars.push(calendar);
            }
          } catch (parseError) {
            // Log but continue processing other responses
            this.logger.warn('Error parsing calendar response:', parseError);
          }
        }
      }

      // Log summary of what we found
      this.logger.info(`Found ${calendars.length} calendars`);

      return calendars;
    } catch (error) {
      this.logger.error('Error fetching calendars:', error);
      throw new Error(`Failed to fetch calendars: ${(error as Error).message}`);
    }
  }

  /**
   * Create a new calendar
   * @param newCalendar Calendar object with properties for the new calendar
   * @returns Promise<Calendar> The created calendar with server-assigned properties
   */
  async createCalendar(newCalendar: Omit<Calendar, 'id' | 'url'>): Promise<Calendar> {
    try {
      // Log with appropriate masking of sensitive data
      this.logger.debug('Creating new calendar:', { displayName: newCalendar.displayName });

      if (!newCalendar.displayName) {
        this.logger.warn('Attempted to create calendar without required displayName');
        throw new Error('Calendar display name is required');
      }

      // Generate a URL-safe calendar ID from the display name
      const calendarId =
        encodeURIComponent(
          newCalendar.displayName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, ''),
        ) +
        '-' +
        Date.now().toString(36);

      // First, make the MKCALENDAR request to create the calendar
      this.logger.debug('Sending MKCALENDAR request to create calendar directory');
      await this.httpClient.mkcalendar(
        calendarId,
        XmlUtils.buildMkcalendarXml(newCalendar.displayName),
      );
      this.logger.debug('MKCALENDAR request successful');

      // Then, set additional properties with PROPPATCH
      this.logger.debug('Sending PROPPATCH request to set additional calendar properties');
      await this.httpClient.proppatch(
        calendarId,
        XmlUtils.buildCalendarPropertiesXml(
          newCalendar.displayName,
          newCalendar.color || '#0082c9',
          newCalendar.category,
          newCalendar.focusPriority,
        ),
      );
      this.logger.debug('PROPPATCH request successful');

      // Create and return the calendar object with server-assigned properties
      this.logger.debug('Creating Calendar object from server-assigned properties');
      const calendar = CalendarUtils.toCalendar({
        id: calendarId,
        displayName: newCalendar.displayName,
        color: newCalendar.color || '#0082c9',
        owner: this.config.username,
        isDefault: false,
        isShared: false,
        isReadOnly: false,
        permissions: {
          canRead: true,
          canWrite: true,
          canShare: true,
          canDelete: true,
        },
        url: `${this.httpClient.getCalDavUrl()}${calendarId}/`,
        category: newCalendar.category,
        focusPriority: newCalendar.focusPriority,
        metadata: newCalendar.metadata,
      });

      this.logger.info(`Calendar created successfully: ${calendarId} (${newCalendar.displayName})`);
      return calendar;
    } catch (error) {
      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error creating calendar:', error);
      throw new Error(`Failed to create calendar: ${(error as Error).message}`);
    }
  }

  /**
   * Update an existing calendar
   * @param calendarId ID of the calendar to update
   * @param updates Calendar object with updated properties
   * @returns Promise<Calendar> The updated calendar
   */
  async updateCalendar(calendarId: string, updates: Partial<Calendar>): Promise<Calendar> {
    try {
      this.logger.debug(`Updating calendar ${calendarId}`, updates);

      // First, verify the calendar exists by trying to get it
      this.logger.debug(`Fetching existing calendar: ${calendarId}`);
      const calendars = await this.getCalendars();
      const existingCalendar = calendars.find((cal) => cal.id === calendarId);

      if (!existingCalendar) {
        this.logger.warn(`Attempted to update non-existent calendar: ${calendarId}`);
        throw new Error(`Calendar with ID ${calendarId} not found`);
      }

      // Check if user has write permissions
      if (existingCalendar.isReadOnly || !existingCalendar.permissions.canWrite) {
        this.logger.warn(
          `Permission denied when updating calendar ${calendarId} - isReadOnly: ${existingCalendar.isReadOnly}, canWrite: ${existingCalendar.permissions.canWrite}`,
        );
        throw new Error('You do not have permission to modify this calendar');
      }

      this.logger.debug(`Permission check passed for calendar ${calendarId}`);

      // Only send PROPPATCH if there are properties to update
      if (Object.keys(updates).length > 0) {
        const properties: Record<string, string | number | null | undefined> = {};

        if (updates.displayName !== undefined) properties.displayName = updates.displayName;
        if (updates.color !== undefined) properties.color = updates.color;
        if (updates.category !== undefined) properties.category = updates.category;
        if (updates.focusPriority !== undefined) properties.focusPriority = updates.focusPriority;

        this.logger.debug(`Sending PROPPATCH request to update calendar ${calendarId} properties`);
        await this.httpClient.proppatch(calendarId, XmlUtils.buildPartialPropertiesXml(properties));
        this.logger.debug('PROPPATCH request for calendar update successful');
      }

      // Return the updated calendar object
      this.logger.debug(`Creating updated Calendar object for ${calendarId}`);
      const updatedCalendar = CalendarUtils.toCalendar({
        ...CalendarUtils.fromCalendar(existingCalendar),
        ...updates,
        id: calendarId, // Preserve original ID
        url: existingCalendar.url, // Preserve original URL
        // Preserve original ownership and permission info
        owner: existingCalendar.owner,
        isDefault: existingCalendar.isDefault,
        isShared: existingCalendar.isShared,
        isReadOnly: existingCalendar.isReadOnly,
        permissions: existingCalendar.permissions,
      });

      this.logger.info(
        `Calendar updated successfully: ${calendarId} (${updatedCalendar.displayName})`,
      );
      return updatedCalendar;
    } catch (error) {
      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error updating calendar:', error);
      throw new Error(`Failed to update calendar: ${(error as Error).message}`);
    }
  }

  /**
   * Delete a calendar
   * @param calendarId ID of the calendar to delete
   * @returns Promise<boolean> True if calendar was deleted successfully
   */
  async deleteCalendar(calendarId: string): Promise<boolean> {
    try {
      this.logger.debug(`Deleting calendar ${calendarId}`);

      // First, verify the calendar exists and check permissions
      this.logger.debug(`Verifying calendar ${calendarId} exists and checking permissions`);
      const calendars = await this.getCalendars();
      const calendar = calendars.find((cal) => cal.id === calendarId);

      if (!calendar) {
        this.logger.warn(`Attempted to delete non-existent calendar: ${calendarId}`);
        throw new Error(`Calendar with ID ${calendarId} not found`);
      }

      // Check if user has delete permissions
      if (!calendar.permissions.canDelete) {
        this.logger.warn(
          `Permission denied when deleting calendar ${calendarId} - canDelete: ${calendar.permissions.canDelete}`,
        );
        throw new Error('You do not have permission to delete this calendar');
      }

      // Prevent deletion of the default calendar
      if (calendar.isDefault) {
        this.logger.warn(`Attempted to delete default calendar: ${calendarId}`);
        throw new Error('The default calendar cannot be deleted');
      }

      this.logger.debug(`Checks passed for calendar deletion: ${calendarId}`);

      // Send DELETE request
      await this.httpClient.deleteCalendar(calendarId);

      this.logger.info(`Calendar ${calendarId} deleted successfully`);
      return true;
    } catch (error) {
      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error deleting calendar:', error);
      throw new Error(`Failed to delete calendar: ${(error as Error).message}`);
    }
  }
}
