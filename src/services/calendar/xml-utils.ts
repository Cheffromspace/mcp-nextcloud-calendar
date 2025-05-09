/**
 * Utilities for XML handling in the Calendar Service
 */
import { parseStringPromise } from 'xml2js';
import { createLogger } from '../logger.js';

const logger = createLogger('CalendarXmlUtils');

/**
 * Escapes special characters in a string to make it safe for XML
 * @param input The string to escape
 * @returns The escaped string
 */
export function escapeXml(input: string | null | undefined): string {
  if (input === null || input === undefined) {
    return '';
  }
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Build the XML request for fetching calendar properties
 * @returns XML string for the PROPFIND request
 */
export function buildCalendarPropertiesRequest(): string {
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
 * Create XML for the MKCALENDAR request
 * @param displayName The calendar display name
 * @returns XML string for creating a calendar
 */
export function buildMkcalendarXml(displayName: string): string {
  const safeDisplayName = escapeXml(displayName);

  return `<?xml version="1.0" encoding="UTF-8"?>
    <x0:mkcalendar xmlns:x0="urn:ietf:params:xml:ns:caldav">
      <x0:set>
        <x0:prop>
          <x0:displayname>${safeDisplayName}</x0:displayname>
        </x0:prop>
      </x0:set>
    </x0:mkcalendar>`;
}

/**
 * Create XML for the PROPPATCH request to set calendar properties
 * @param displayName The calendar display name
 * @param color The calendar color in hex format
 * @param category Optional category for ADHD-friendly organization
 * @param focusPriority Optional priority level for ADHD focus management
 * @returns XML string for setting calendar properties
 */
export function buildCalendarPropertiesXml(
  displayName: string,
  color: string = '#0082c9',
  category?: string | null,
  focusPriority?: number | null,
): string {
  const safeDisplayName = escapeXml(displayName);
  const safeColor = escapeXml(color);
  const safeCategory = category ? escapeXml(category) : '';
  const safeFocusPriority =
    focusPriority !== undefined && focusPriority !== null ? escapeXml(String(focusPriority)) : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
    <x0:propertyupdate xmlns:x0="DAV:" xmlns:x1="http://apple.com/ns/ical/"
                      xmlns:x2="http://owncloud.org/ns" xmlns:x3="http://calendarserver.org/ns/">
      <x0:set>
        <x0:prop>
          <x0:displayname>${safeDisplayName}</x0:displayname>
          <x1:calendar-color>${safeColor}</x1:calendar-color>
          ${safeCategory ? `<x2:calendar-category>${safeCategory}</x2:calendar-category>` : ''}
          ${safeFocusPriority ? `<x2:calendar-focus-priority>${safeFocusPriority}</x2:calendar-focus-priority>` : ''}
        </x0:prop>
      </x0:set>
    </x0:propertyupdate>`;
}

/**
 * Create XML for partial property updates
 * @param properties Object with property names and values to update
 * @returns XML string for updating specific properties
 */
export function buildPartialPropertiesXml(
  properties: Record<string, string | number | null | undefined>,
): string {
  let propXml = '';

  if (properties.displayName !== undefined) {
    propXml += `<x0:displayname>${escapeXml(String(properties.displayName))}</x0:displayname>`;
  }

  if (properties.color !== undefined) {
    propXml += `<x1:calendar-color>${escapeXml(String(properties.color))}</x1:calendar-color>`;
  }

  if (properties.category !== undefined) {
    propXml += `<x2:calendar-category>${escapeXml(String(properties.category))}</x2:calendar-category>`;
  }

  if (properties.focusPriority !== undefined) {
    propXml += `<x2:calendar-focus-priority>${escapeXml(String(properties.focusPriority))}</x2:calendar-focus-priority>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
    <x0:propertyupdate xmlns:x0="DAV:" xmlns:x1="http://apple.com/ns/ical/"
                      xmlns:x2="http://owncloud.org/ns" xmlns:x3="http://calendarserver.org/ns/">
      <x0:set>
        <x0:prop>
          ${propXml}
        </x0:prop>
      </x0:set>
    </x0:propertyupdate>`;
}

/**
 * Parse XML response from WebDAV with robust error handling
 * @param xmlString The XML string to parse
 * @returns Parsed XML object
 */
export async function parseXmlResponse(xmlString: string): Promise<Record<string, unknown>> {
  try {
    // Try to parse with default options first
    return await parseStringPromise(xmlString, {
      explicitArray: false,
      // Normalize tag names to handle different Nextcloud versions
      normalizeTags: true,
      // Make attribute names more consistent
      normalize: true,
    });
  } catch (parseError) {
    logger.warn('Initial XML parsing failed, trying with alternative options:', parseError);
    // Try again with different options
    return await parseStringPromise(xmlString, {
      explicitArray: true,
      normalizeTags: true,
    });
  }
}

/**
 * Safely navigate the multistatus response
 * @param xmlData The parsed XML data
 * @returns The multistatus element or null if not found
 */
export function getMultistatus(xmlData: Record<string, unknown>): Record<string, unknown> | null {
  // Try different possible paths to find the multistatus element
  if (xmlData && xmlData['d:multistatus'])
    return xmlData['d:multistatus'] as Record<string, unknown>;
  if (xmlData && xmlData['multistatus']) return xmlData['multistatus'] as Record<string, unknown>;

  // Try to find any property that might contain 'multistatus' in a case-insensitive way
  if (xmlData) {
    for (const key of Object.keys(xmlData)) {
      if (key.toLowerCase().includes('multistatus')) {
        return xmlData[key] as Record<string, unknown>;
      }
    }
  }

  return null;
}

/**
 * Get response elements from a multistatus object
 * @param multistatus The multistatus object
 * @returns Array of response elements
 */
export function getResponses(multistatus: Record<string, unknown>): Array<Record<string, unknown>> {
  if (multistatus['d:response'])
    return Array.isArray(multistatus['d:response'])
      ? (multistatus['d:response'] as Array<Record<string, unknown>>)
      : [multistatus['d:response'] as Record<string, unknown>];

  if (multistatus['response'])
    return Array.isArray(multistatus['response'])
      ? (multistatus['response'] as Array<Record<string, unknown>>)
      : [multistatus['response'] as Record<string, unknown>];

  // Look for any key containing 'response'
  for (const key of Object.keys(multistatus)) {
    if (key.toLowerCase().includes('response')) {
      const responseElement = multistatus[key];
      return Array.isArray(responseElement)
        ? (responseElement as Array<Record<string, unknown>>)
        : [responseElement as Record<string, unknown>];
    }
  }

  return [];
}
