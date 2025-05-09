import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { NextcloudConfig } from '../config/config.js';
import { Calendar, CalendarUtils } from '../models/index.js';
import { createLogger } from './logger.js';
import { escapeXml, createXmlElement } from '../utils/index.js';

export class CalendarService {
  private config: NextcloudConfig;
  private authHeader: string;
  private baseUrl: string;
  private caldavUrl: string;
  private logger = createLogger('CalendarService');

  constructor(config: NextcloudConfig) {
    this.config = config;

    if (!this.config.baseUrl || !this.config.username || !this.config.appToken) {
      throw new Error('Nextcloud configuration is incomplete');
    }

    // Remove trailing slash if present
    this.baseUrl = this.config.baseUrl.replace(/\/$/, '');

    // Create the CalDAV URL for the user
    this.caldavUrl = `${this.baseUrl}/remote.php/dav/calendars/${this.config.username}/`;

    // Log initialization without sensitive details
    this.logger.info('CalendarService initialized successfully', {
      baseUrl: this.baseUrl,
      username: this.config.username,
      // Don't include appToken
    });

    // Create Basic Auth header
    // Use global Buffer (available in Node.js)
    // eslint-disable-next-line no-undef
    const auth = Buffer.from(`${config.username}:${config.appToken}`).toString('base64');
    this.authHeader = `Basic ${auth}`;
  }

  /**
   * Build the XML request for fetching calendar properties
   * @returns XML string for the PROPFIND request
   */
  private buildCalendarPropertiesRequest(): string {
    return `<?xml version="1.0" encoding="utf-8" ?>
      <d:propfind xmlns:d="DAV:" xmlns:cal="urn:ietf:params:xml:ns:caldav"
          xmlns:cs="http://calendarserver.org/ns/" xmlns:oc="http://owncloud.org/ns">
        <d:prop>
          <d:resourcetype />
          <d:displayname />
          <cal:supported-calendar-component-set />
          <cs:getctag />
          <oc:calendar-enabled />
          <d:sync-token />
          <oc:owner-principal />
          <d:current-user-privilege-set />
          <oc:invite />
          <oc:calendar-order />
          <d:color />
        </d:prop>
      </d:propfind>`;
  }

  /**
   * Extract the calendar ID from a WebDAV href
   * @param href The WebDAV href path
   * @returns The extracted calendar ID
   */
  private extractCalendarId(href: string): string {
    return href.split('/').filter(Boolean).pop() || '';
  }

  /**
   * Check if a WebDAV resource is a calendar
   * @param resourceType The resource type object from WebDAV
   * @returns True if the resource is a calendar
   */
  private isCalendarResource(resourceType: unknown): boolean {
    if (!resourceType) return false;

    // Check for the cal:calendar property
    if (resourceType && typeof resourceType === 'object') {
      // Direct match for cal:calendar property (typical for Nextcloud)
      if ('cal:calendar' in resourceType) {
        return true;
      }

      // Check for 'calendar' XML tag with a different namespace
      for (const key of Object.keys(resourceType)) {
        // Check for any property with calendar in its name regardless of namespace
        if (key.includes('calendar')) {
          return true;
        }
      }

      // Handle nested resourcetype structures (some Nextcloud versions)
      const resourceObj = resourceType as Record<string, unknown>;
      for (const key of Object.keys(resourceObj)) {
        if (key === 'collection' && resourceObj[key]) {
          // Some Nextcloud versions use a nested structure with a collection property
          // containing calendars
          return true;
        }
      }
    }

    // If resourceType is a string that contains "calendar"
    if (typeof resourceType === 'string' && resourceType.toLowerCase().includes('calendar')) {
      return true;
    }

    return false;
  }

  /**
   * Extract owner information from WebDAV properties
   * @param ownerPrincipal The owner principal string from WebDAV
   * @returns The extracted owner username
   */
  private extractOwner(ownerPrincipal: string | null | undefined): string {
    if (!ownerPrincipal) return this.config.username;

    const ownerMatch = ownerPrincipal.match(/principal:principals\/users\/([^/]+)/);
    if (ownerMatch && ownerMatch[1]) {
      return ownerMatch[1];
    }

    return this.config.username;
  }

  /**
   * Normalize color value from WebDAV properties
   * @param color The color string from WebDAV
   * @returns Normalized color string in hex format
   */
  private normalizeColor(color: string | null | undefined): string {
    // Default color for Nextcloud
    const defaultColor = '#0082c9';

    if (!color) return defaultColor;

    // Remove quotes if present
    if (typeof color === 'string' && color.startsWith('"') && color.endsWith('"')) {
      color = color.substring(1, color.length - 1);
    }

    // Validate it's a proper hex color
    if (typeof color === 'string' && /^#[0-9A-F]{3,6}$/i.test(color)) {
      return color;
    }

    return defaultColor;
  }

  /**
   * Extract calendar properties from WebDAV response
   * @param response The WebDAV response object
   * @returns The extracted calendar or null if not a calendar
   */
  private parseCalendarResponse(response: Record<string, unknown>): Calendar | null {
    // Skip responses without proper structure
    if (!response['d:href'] || !response['d:propstat']) {
      return null;
    }

    // Skip parent directory response
    if (response['d:href'] === this.caldavUrl.substring(this.baseUrl.length)) {
      return null;
    }

    // Find successful propstat
    const propstat = Array.isArray(response['d:propstat'])
      ? response['d:propstat'].find(
          (ps: { 'd:status'?: string }) => ps['d:status'] === 'HTTP/1.1 200 OK',
        )
      : response['d:propstat'];

    if (!propstat || !propstat['d:prop']) {
      return null;
    }

    const prop = propstat['d:prop'];

    // Check if this is a calendar resource
    if (!this.isCalendarResource(prop['d:resourcetype'])) {
      return null;
    }

    // Extract the calendar ID
    const calendarId = this.extractCalendarId(String(response['d:href']));
    if (!calendarId) {
      return null;
    }

    // Skip disabled calendars if the property exists
    if (prop['oc:calendar-enabled'] === '0') {
      return null;
    }

    // Extract other properties
    const privileges = this.parsePrivilegeSet(prop['d:current-user-privilege-set']);
    const isShared = !!prop['oc:invite'];
    const owner = this.extractOwner(prop['oc:owner-principal']);
    const color = this.normalizeColor(prop['d:color'] || prop['x1:calendar-color']);

    // Create calendar object
    return CalendarUtils.toCalendar({
      id: calendarId,
      displayName: prop['d:displayname'] || calendarId,
      color: color,
      owner: owner,
      isDefault: calendarId === 'personal', // Personal is usually the default calendar
      isShared: isShared,
      isReadOnly: !privileges.canWrite,
      permissions: {
        canRead: privileges.canRead,
        canWrite: privileges.canWrite,
        canShare: privileges.canShare,
        canDelete: privileges.canDelete,
      },
      url: `${this.baseUrl}${response['d:href']}`,
      // For ADHD-friendly organization
      category: null,
      focusPriority: null,
      metadata: null,
    });
  }

  /**
   * Get a list of all calendars for the user
   * @returns Promise<Calendar[]> List of calendars
   */
  async getCalendars(): Promise<Calendar[]> {
    try {
      // Make request to Nextcloud CalDAV endpoint with PROPFIND
      const response = await axios({
        method: 'PROPFIND',
        url: this.caldavUrl,
        headers: {
          Authorization: this.authHeader,
          Depth: '1',
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data: this.buildCalendarPropertiesRequest(),
      });

      // Parse XML response with more robust error handling
      let xmlData;
      try {
        // Try to parse with default options first
        xmlData = await parseStringPromise(response.data, {
          explicitArray: false,
          // Normalize tag names to handle different Nextcloud versions
          normalizeTags: true,
          // Make attribute names more consistent
          normalize: true,
        });
      } catch (parseError) {
        this.logger.warn(
          'Initial XML parsing failed, trying with alternative options:',
          parseError,
        );
        // Try again with different options
        xmlData = await parseStringPromise(response.data, {
          explicitArray: true,
          normalizeTags: true,
        });
      }

      // Extract calendar information
      const calendars: Calendar[] = [];

      // Safely navigate the XML structure with multiple fallbacks
      const getMultistatus = () => {
        // Try different possible paths to find the multistatus element
        if (xmlData && xmlData['d:multistatus']) return xmlData['d:multistatus'];
        if (xmlData && xmlData['multistatus']) return xmlData['multistatus'];

        // Try to find any property that might contain 'multistatus' in a case-insensitive way
        if (xmlData) {
          for (const key of Object.keys(xmlData)) {
            if (key.toLowerCase().includes('multistatus')) {
              return xmlData[key];
            }
          }
        }

        return null;
      };

      const multistatus = getMultistatus();
      if (multistatus) {
        // Try to find the response property (might have different names)
        const getResponses = () => {
          if (multistatus['d:response']) return multistatus['d:response'];
          if (multistatus['response']) return multistatus['response'];

          // Look for any key containing 'response'
          for (const key of Object.keys(multistatus)) {
            if (key.toLowerCase().includes('response')) {
              return multistatus[key];
            }
          }

          return null;
        };

        const responseElement = getResponses();
        if (responseElement) {
          // Handle different possible structures
          const responses = Array.isArray(responseElement) ? responseElement : [responseElement];

          // Process each response
          for (const response of responses) {
            try {
              const calendar = this.parseCalendarResponse(response);
              if (calendar) {
                calendars.push(calendar);
              }
            } catch (parseError) {
              // Log but continue processing other responses
              this.logger.warn('Error parsing calendar response:', parseError);
            }
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

      // Calendar URL to create
      const calendarUrl = this.caldavUrl + calendarId + '/';

      // Build XML for calendar properties - use utility function to safely escape user input
      const displayNameEl = createXmlElement('x0:displayname', newCalendar.displayName);
      const colorEl = createXmlElement('x1:calendar-color', newCalendar.color || '#0082c9');
      const categoryEl = newCalendar.category
        ? createXmlElement('x2:calendar-category', newCalendar.category)
        : '';
      const focusPriorityEl = newCalendar.focusPriority
        ? createXmlElement('x2:calendar-focus-priority', String(newCalendar.focusPriority))
        : '';

      const proppatchXml = `<?xml version="1.0" encoding="UTF-8"?>
        <x0:propertyupdate xmlns:x0="DAV:" xmlns:x1="http://apple.com/ns/ical/"
                          xmlns:x2="http://owncloud.org/ns" xmlns:x3="http://calendarserver.org/ns/">
          <x0:set>
            <x0:prop>
              ${displayNameEl}
              ${colorEl}
              ${categoryEl}
              ${focusPriorityEl}
            </x0:prop>
          </x0:set>
        </x0:propertyupdate>`;

      // First, make the MKCALENDAR request to create the calendar
      this.logger.debug('Sending MKCALENDAR request to create calendar directory');
      await axios({
        method: 'MKCALENDAR',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data: `<?xml version="1.0" encoding="UTF-8"?>
          <x0:mkcalendar xmlns:x0="urn:ietf:params:xml:ns:caldav">
            <x0:set>
              <x0:prop>
                ${createXmlElement('x0:displayname', newCalendar.displayName)}
              </x0:prop>
            </x0:set>
          </x0:mkcalendar>`,
      });
      this.logger.debug('MKCALENDAR request successful');

      // Then, set additional properties with PROPPATCH
      this.logger.debug('Sending PROPPATCH request to set additional calendar properties');
      await axios({
        method: 'PROPPATCH',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/xml; charset=utf-8',
        },
        data: proppatchXml,
      });
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
        url: calendarUrl,
        category: newCalendar.category,
        focusPriority: newCalendar.focusPriority,
        metadata: newCalendar.metadata,
      });

      this.logger.info(`Calendar created successfully: ${calendarId} (${newCalendar.displayName})`);
      return calendar;
    } catch (error) {
      // Check for specific error types
      if (axios.isAxiosError(error)) {
        const status = error.response?.status || 500;

        // Handle common HTTP errors with more specific messages
        if (status === 401 || status === 403) {
          throw new Error('Unauthorized: You do not have permission to create calendars.');
        } else if (status === 405) {
          throw new Error('Calendar creation not supported by this server.');
        } else if (status === 409 || status === 423) {
          throw new Error('Calendar already exists or resource is locked.');
        } else if (status === 507) {
          throw new Error('Insufficient storage space to create calendar.');
        }
      }

      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error creating calendar:', error);
      throw new Error('Failed to create calendar. Please try again later.');
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

      // Calendar URL to update
      const calendarUrl = this.caldavUrl + calendarId + '/';

      // Build XML property update document - only include properties that are being updated
      // Escape all user input to prevent XML injection
      let propXml = '';

      if (updates.displayName !== undefined) {
        propXml += createXmlElement('x0:displayname', updates.displayName);
      }

      if (updates.color !== undefined) {
        propXml += createXmlElement('x1:calendar-color', updates.color);
      }

      if (updates.category !== undefined) {
        propXml += createXmlElement('x2:calendar-category', updates.category);
      }

      if (updates.focusPriority !== undefined) {
        propXml += createXmlElement('x2:calendar-focus-priority', String(updates.focusPriority));
      }

      // Only send PROPPATCH if there are properties to update
      if (propXml) {
        const proppatchXml = `<?xml version="1.0" encoding="UTF-8"?>
          <x0:propertyupdate xmlns:x0="DAV:" xmlns:x1="http://apple.com/ns/ical/"
                            xmlns:x2="http://owncloud.org/ns" xmlns:x3="http://calendarserver.org/ns/">
            <x0:set>
              <x0:prop>
                ${propXml}
              </x0:prop>
            </x0:set>
          </x0:propertyupdate>`;

        this.logger.debug(`Sending PROPPATCH request to update calendar ${calendarId} properties`);
        await axios({
          method: 'PROPPATCH',
          url: calendarUrl,
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/xml; charset=utf-8',
          },
          data: proppatchXml,
        });
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
      // Check for specific error types
      if (axios.isAxiosError(error)) {
        const status = error.response?.status || 500;

        // Handle common HTTP errors with more specific messages
        if (status === 401 || status === 403) {
          throw new Error('Unauthorized: You do not have permission to update this calendar.');
        } else if (status === 404) {
          throw new Error(`Calendar with ID ${calendarId} not found.`);
        } else if (status === 423) {
          throw new Error('Calendar is locked and cannot be modified.');
        }
      }

      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error updating calendar:', error);
      throw new Error('Failed to update calendar. Please try again later.');
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
        throw new Error(`Calendar with ID ${escapeXml(calendarId)} not found`);
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

      // Calendar URL to delete
      const calendarUrl = this.caldavUrl + calendarId + '/';

      // Send DELETE request
      this.logger.debug(`Sending DELETE request for calendar ${calendarId}`);
      await axios({
        method: 'DELETE',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
        },
      });

      this.logger.info(`Calendar ${calendarId} deleted successfully`);
      return true;
    } catch (error) {
      // Check for specific error types
      if (axios.isAxiosError(error)) {
        const status = error.response?.status || 500;

        // Handle common HTTP errors with more specific messages
        if (status === 401 || status === 403) {
          throw new Error('Unauthorized: You do not have permission to delete this calendar.');
        } else if (status === 404) {
          throw new Error(`Calendar with ID ${calendarId} not found.`);
        } else if (status === 423) {
          throw new Error('Calendar is locked and cannot be deleted.');
        } else if (status === 409) {
          throw new Error(
            'Calendar cannot be deleted because it contains events. Delete all events first.',
          );
        }
      }

      // Log error details for debugging, but don't expose them to the client
      this.logger.error('Error deleting calendar:', error);
      throw new Error('Failed to delete calendar. Please try again later.');
    }
  }

  /**
   * Helper function to parse WebDAV privilege set into permission object
   */
  private parsePrivilegeSet(privilegeSet: Record<string, unknown> | null): {
    canRead: boolean;
    canWrite: boolean;
    canShare: boolean;
    canDelete: boolean;
  } {
    const permissions = {
      canRead: false,
      canWrite: false,
      canShare: false,
      canDelete: false,
    };

    // If no privilege set provided, default to read-only access
    if (!privilegeSet) {
      permissions.canRead = true;
      return permissions;
    }

    // If no privileges found, assume read access
    if (!privilegeSet['d:privilege']) {
      permissions.canRead = true;
      return permissions;
    }

    const privileges = Array.isArray(privilegeSet['d:privilege'])
      ? privilegeSet['d:privilege']
      : [privilegeSet['d:privilege']];

    // For Nextcloud, assume we have read access if we can see the calendar at all
    permissions.canRead = true;

    for (const privilege of privileges) {
      // Write permissions
      if (privilege['d:write'] || privilege['d:write-content'] || privilege['d:write-properties']) {
        permissions.canWrite = true;
      }

      // Share permission (Nextcloud specific)
      if (privilege['d:share'] || privilege['oc:share']) {
        permissions.canShare = true;
      }

      // Delete permission
      if (privilege['d:unbind'] || privilege['d:write']) {
        permissions.canDelete = true;
      }
    }

    return permissions;
  }
}
