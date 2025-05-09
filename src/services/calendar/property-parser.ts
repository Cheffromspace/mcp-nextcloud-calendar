/**
 * Utilities for parsing and handling calendar properties
 */
import { Calendar, CalendarPermissions, CalendarUtils } from '../../models/index.js';

/**
 * Extract the calendar ID from a WebDAV href
 * @param href The WebDAV href path
 * @returns The extracted calendar ID
 */
export function extractCalendarId(href: string): string {
  return href.split('/').filter(Boolean).pop() || '';
}

/**
 * Check if a WebDAV resource is a calendar
 * @param resourceType The resource type object from WebDAV
 * @returns True if the resource is a calendar
 */
export function isCalendarResource(resourceType: unknown): boolean {
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
 * @param defaultUsername Default username to use if owner cannot be extracted
 * @returns The extracted owner username
 */
export function extractOwner(
  ownerPrincipal: string | null | undefined,
  defaultUsername: string,
): string {
  if (!ownerPrincipal) return defaultUsername;

  const ownerMatch = ownerPrincipal.match(/principal:principals\/users\/([^/]+)/);
  if (ownerMatch && ownerMatch[1]) {
    return ownerMatch[1];
  }

  return defaultUsername;
}

/**
 * Normalize color value from WebDAV properties
 * @param color The color string from WebDAV
 * @returns Normalized color string in hex format
 */
export function normalizeColor(color: string | null | undefined): string {
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
 * Parse WebDAV privilege set into permission object
 */
export function parsePrivilegeSet(
  privilegeSet: Record<string, unknown> | null,
): CalendarPermissions {
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

/**
 * Extract calendar properties from WebDAV response
 * @param response The WebDAV response object
 * @param baseUrl The base URL for the Nextcloud server
 * @param caldavUrl The CalDAV URL base path
 * @param defaultUsername The default username to use
 * @returns The extracted calendar or null if not a calendar
 */
export function parseCalendarResponse(
  response: Record<string, unknown>,
  baseUrl: string,
  caldavUrl: string,
  defaultUsername: string,
): Calendar | null {
  // Skip responses without proper structure
  if (!response['d:href'] || !response['d:propstat']) {
    return null;
  }

  // Skip parent directory response
  if (response['d:href'] === caldavUrl.substring(baseUrl.length)) {
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
  if (!isCalendarResource(prop['d:resourcetype'])) {
    return null;
  }

  // Extract the calendar ID
  const calendarId = extractCalendarId(String(response['d:href']));
  if (!calendarId) {
    return null;
  }

  // Skip disabled calendars if the property exists
  if (prop['oc:calendar-enabled'] === '0') {
    return null;
  }

  // Extract other properties
  const privileges = parsePrivilegeSet(prop['d:current-user-privilege-set']);
  const isShared = !!prop['oc:invite'];
  const owner = extractOwner(prop['oc:owner-principal'], defaultUsername);
  const color = normalizeColor(prop['d:color'] || prop['x1:calendar-color']);

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
    url: `${baseUrl}${response['d:href']}`,
    // For ADHD-friendly organization
    category: null,
    focusPriority: null,
    metadata: null,
  });
}
