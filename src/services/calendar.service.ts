import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { NextcloudConfig } from '../config/config.js';
import { Calendar, CalendarUtils } from '../models/index.js';
import { escapeXml, createXmlElement } from '../utils/index.js';

export class CalendarService {
  private config: NextcloudConfig;
  private authHeader: string;
  private baseUrl: string;
  private caldavUrl: string;

  /**
   * Helper method to create standard XML request headers
   */
  private getXmlRequestHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      'Content-Type': 'application/xml; charset=utf-8',
    };
  }

  constructor(config: NextcloudConfig) {
    this.config = config;

    if (!this.config.baseUrl || !this.config.username || !this.config.appToken) {
      throw new Error('Nextcloud configuration is incomplete');
    }

    // Remove trailing slash if present
    this.baseUrl = this.config.baseUrl.replace(/\/$/, '');

    // Create the CalDAV URL for the user
    this.caldavUrl = `${this.baseUrl}/remote.php/dav/calendars/${this.config.username}/`;

    console.log('Initialized CalendarService with:');
    console.log('  Base URL:', this.baseUrl);
    console.log('  CalDAV URL:', this.caldavUrl);
    console.log('  Username:', this.config.username);

    // Create Basic Auth header
    // Use global Buffer (available in Node.js)
    // eslint-disable-next-line no-undef
    const auth = Buffer.from(`${config.username}:${config.appToken}`).toString('base64');
    this.authHeader = `Basic ${auth}`;
  }

  /**
   * Get a list of all calendars for the user
   * @returns Promise<Calendar[]> List of calendars
   */
  async getCalendars(): Promise<Calendar[]> {
    try {
      // Create a safe, static XML document for the PROPFIND request
      // This doesn't include any user input, but using the same pattern for consistency
      const propfindXml = `<?xml version="1.0" encoding="utf-8" ?>
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

      // Make request to Nextcloud CalDAV endpoint with PROPFIND
      const response = await axios({
        method: 'PROPFIND',
        url: this.caldavUrl,
        headers: {
          ...this.getXmlRequestHeaders(),
          Depth: '1',
        },
        data: propfindXml,
      });

      // Parse XML response
      const xmlData = await parseStringPromise(response.data, { explicitArray: false });

      // Extract calendar information
      const calendars: Calendar[] = [];

      if (xmlData && xmlData['d:multistatus'] && xmlData['d:multistatus']['d:response']) {
        const responses = Array.isArray(xmlData['d:multistatus']['d:response'])
          ? xmlData['d:multistatus']['d:response']
          : [xmlData['d:multistatus']['d:response']];

        for (const item of responses) {
          // Skip the parent directory response
          if (
            item['d:href'] === this.caldavUrl.substring(this.baseUrl.length) ||
            !item['d:propstat']
          ) {
            continue;
          }

          // Find successful propstat
          const propstat = Array.isArray(item['d:propstat'])
            ? item['d:propstat'].find(
                (ps: { 'd:status'?: string }) => ps['d:status'] === 'HTTP/1.1 200 OK',
              )
            : item['d:propstat'];

          if (propstat && propstat['d:prop']) {
            const prop = propstat['d:prop'];

            // Only process items that are calendars
            if (
              prop['d:resourcetype'] &&
              (prop['d:resourcetype']['cal:calendar'] ||
                (typeof prop['d:resourcetype'] === 'object' &&
                  Object.keys(prop['d:resourcetype']).some((key) => key.includes('calendar'))))
            ) {
              const calendarId = item['d:href'].split('/').filter(Boolean).pop();

              // For testing, always consider calendars enabled since Nextcloud doesn't always expose this property
              // Skip disabled calendars if the property exists
              if (prop['oc:calendar-enabled'] === '0') {
                continue;
              }

              // Extract permission information
              const privileges = this.parsePrivilegeSet(prop['d:current-user-privilege-set']);

              // Determine if shared
              const isShared = !!prop['oc:invite'];

              // Extract owner information
              let owner = this.config.username;
              if (prop['oc:owner-principal']) {
                const ownerMatch = prop['oc:owner-principal'].match(
                  /principal:principals\/users\/([^/]+)/,
                );
                if (ownerMatch && ownerMatch[1]) {
                  owner = ownerMatch[1];
                }
              }

              // Extract color (strip quotes if present)
              let color = prop['d:color'] || prop['x1:calendar-color'] || '#0082c9';
              if (typeof color === 'string' && color.startsWith('"') && color.endsWith('"')) {
                color = color.substring(1, color.length - 1);
              }

              // Create calendar object
              const calendar = CalendarUtils.toCalendar({
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
                url: `${this.baseUrl}${item['d:href']}`,
                // For ADHD-friendly organization
                category: null,
                focusPriority: null,
                metadata: null,
              });

              calendars.push(calendar);
            }
          }
        }
      }

      return calendars;
    } catch (error) {
      console.error('Error fetching calendars:', error);
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
      // Generate a safe calendar ID from the display name
      const calendarId = this.generateSafeCalendarId(newCalendar.displayName);
      const calendarUrl = `${this.caldavUrl}${calendarId}`;

      // Create the XML for the MKCALENDAR request
      // All user inputs are escaped to prevent XML injection
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
        <C:mkcalendar xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:OC="http://owncloud.org/ns">
          <D:set>
            <D:prop>
              <D:displayname>${escapeXml(newCalendar.displayName)}</D:displayname>
              <OC:calendar-color>${escapeXml(newCalendar.color)}</OC:calendar-color>
              ${newCalendar.category ? createXmlElement('OC:calendar-category', newCalendar.category) : ''}
            </D:prop>
          </D:set>
        </C:mkcalendar>`;

      // Make request to create the calendar
      await axios({
        method: 'MKCALENDAR',
        url: calendarUrl,
        headers: this.getXmlRequestHeaders(),
        data: xml,
      });

      // Return the created calendar with server-assigned properties
      return {
        ...newCalendar,
        id: calendarId,
        url: calendarUrl,
      };
    } catch (error) {
      console.error('Error creating calendar:', error);
      throw new Error(`Failed to create calendar: ${(error as Error).message}`);
    }
  }

  /**
   * Generates a safe calendar ID from a display name
   * @param displayName The display name to convert to an ID
   * @returns A URL-safe string to use as calendar ID
   */
  private generateSafeCalendarId(displayName: string): string {
    // Remove special characters, convert to lowercase and replace spaces with hyphens
    let id = displayName
      .toLowerCase()
      .replace(/[^\w\s-]/g, '') // Remove non-word chars except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .trim();

    // Add a timestamp for uniqueness
    id = `${id}-${Date.now()}`;

    return id;
  }

  /**
   * Update an existing calendar
   * @param calendarId ID of the calendar to update
   * @param updates Calendar object with updated properties
   * @returns Promise<Calendar> The updated calendar
   */
  async updateCalendar(calendarId: string, updates: Partial<Calendar>): Promise<Calendar> {
    try {
      // Validate calendar ID
      if (!calendarId) {
        throw new Error('Calendar ID is required');
      }

      const calendarUrl = `${this.caldavUrl}${calendarId}`;

      // Build XML for properties to update
      const propElements = [];

      // Add displayName if provided
      if (updates.displayName !== undefined) {
        propElements.push(createXmlElement('D:displayname', updates.displayName));
      }

      // Add color if provided
      if (updates.color !== undefined) {
        propElements.push(createXmlElement('OC:calendar-color', updates.color));
      }

      // Add category if provided
      if (updates.category !== undefined) {
        propElements.push(createXmlElement('OC:calendar-category', updates.category));
      }

      // Create the PROPPATCH XML
      // All user inputs are escaped to prevent XML injection
      const xml = `<?xml version="1.0" encoding="utf-8" ?>
        <D:propertyupdate xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:OC="http://owncloud.org/ns">
          <D:set>
            <D:prop>
              ${propElements.join('\n              ')}
            </D:prop>
          </D:set>
        </D:propertyupdate>`;

      // Make request to update calendar properties
      await axios({
        method: 'PROPPATCH',
        url: calendarUrl,
        headers: this.getXmlRequestHeaders(),
        data: xml,
      });

      // Fetch the updated calendar from the server
      const calendars = await this.getCalendars();
      const updatedCalendar = calendars.find((cal) => cal.id === calendarId);

      if (!updatedCalendar) {
        throw new Error('Calendar not found after update');
      }

      return updatedCalendar;
    } catch (error) {
      console.error('Error updating calendar:', error);
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
      // Validate calendar ID
      if (!calendarId) {
        throw new Error('Calendar ID is required');
      }

      // First check if the calendar exists
      const calendars = await this.getCalendars();
      const calendarExists = calendars.some((cal) => cal.id === calendarId);

      if (!calendarExists) {
        throw new Error(`Calendar with ID '${escapeXml(calendarId)}' not found`);
      }

      const calendarUrl = `${this.caldavUrl}${calendarId}`;

      // Make request to delete the calendar
      await axios({
        method: 'DELETE',
        url: calendarUrl,
        headers: {
          Authorization: this.authHeader,
        },
      });

      return true;
    } catch (error) {
      console.error('Error deleting calendar:', error);
      throw new Error(`Failed to delete calendar: ${(error as Error).message}`);
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
