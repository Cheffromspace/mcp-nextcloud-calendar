import * as XmlUtils from '../services/calendar/xml-utils.js';

describe('XML Utilities', () => {
  describe('escapeXml', () => {
    it('should escape special XML characters', () => {
      const input = '<tag>Text & "quotes" \'</tag>';
      const expected = '&lt;tag&gt;Text &amp; &quot;quotes&quot; &apos;&lt;/tag&gt;';

      expect(XmlUtils.escapeXml(input)).toBe(expected);
    });

    it('should handle null and undefined inputs', () => {
      expect(XmlUtils.escapeXml(null)).toBe('');
      expect(XmlUtils.escapeXml(undefined)).toBe('');
    });

    it('should convert non-string values to strings', () => {
      // @ts-expect-error: Testing behavior with invalid input type
      expect(XmlUtils.escapeXml(123)).toBe('123');
      // @ts-expect-error: Testing behavior with invalid input type
      expect(XmlUtils.escapeXml(true)).toBe('true');
    });
  });

  describe('buildCalendarPropertiesRequest', () => {
    it('should generate valid XML for PROPFIND request', () => {
      const xml = XmlUtils.buildCalendarPropertiesRequest();

      // Basic validation of the XML structure
      expect(xml).toContain('<?xml version="1.0" encoding="utf-8" ?>');
      expect(xml).toContain('<d:propfind');
      expect(xml).toContain('<d:displayname />');
      expect(xml).toContain('<d:resourcetype />');
    });
  });

  describe('buildMkcalendarXml', () => {
    it('should generate valid XML for MKCALENDAR request', () => {
      const displayName = 'Test Calendar';
      const xml = XmlUtils.buildMkcalendarXml(displayName);

      // Basic validation of the XML structure
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<x0:mkcalendar');
      expect(xml).toContain(`<x0:displayname>${displayName}</x0:displayname>`);
    });

    it('should escape special characters in displayName', () => {
      const displayName = '<Test & Calendar>';
      const escapedName = '&lt;Test &amp; Calendar&gt;';
      const xml = XmlUtils.buildMkcalendarXml(displayName);

      expect(xml).toContain(`<x0:displayname>${escapedName}</x0:displayname>`);
    });
  });

  describe('buildCalendarPropertiesXml', () => {
    it('should generate valid XML with required properties', () => {
      const displayName = 'Test Calendar';
      const color = '#FF5733';
      const xml = XmlUtils.buildCalendarPropertiesXml(displayName, color);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain(`<x0:displayname>${displayName}</x0:displayname>`);
      expect(xml).toContain(`<x1:calendar-color>${color}</x1:calendar-color>`);
    });

    it('should include optional properties when provided', () => {
      const displayName = 'Test Calendar';
      const color = '#FF5733';
      const category = 'Work';
      const focusPriority = 5;

      const xml = XmlUtils.buildCalendarPropertiesXml(displayName, color, category, focusPriority);

      expect(xml).toContain(`<x2:calendar-category>${category}</x2:calendar-category>`);
      expect(xml).toContain(
        `<x2:calendar-focus-priority>${focusPriority}</x2:calendar-focus-priority>`,
      );
    });

    it('should exclude optional properties when not provided', () => {
      const displayName = 'Test Calendar';
      const xml = XmlUtils.buildCalendarPropertiesXml(displayName);

      expect(xml).not.toContain('<x2:calendar-category>');
      expect(xml).not.toContain('<x2:calendar-focus-priority>');
    });

    it('should use default color when not provided', () => {
      const displayName = 'Test Calendar';
      const xml = XmlUtils.buildCalendarPropertiesXml(displayName);

      expect(xml).toContain('<x1:calendar-color>#0082c9</x1:calendar-color>');
    });
  });

  describe('buildPartialPropertiesXml', () => {
    it('should generate XML with only specified properties', () => {
      const properties = {
        displayName: 'Updated Calendar',
        color: '#00FF00',
      };

      const xml = XmlUtils.buildPartialPropertiesXml(properties);

      expect(xml).toContain(`<x0:displayname>${properties.displayName}</x0:displayname>`);
      expect(xml).toContain(`<x1:calendar-color>${properties.color}</x1:calendar-color>`);
      expect(xml).not.toContain('<x2:calendar-category>');
      expect(xml).not.toContain('<x2:calendar-focus-priority>');
    });

    it('should handle empty properties object', () => {
      const xml = XmlUtils.buildPartialPropertiesXml({});

      // Should still have basic XML structure but no property elements
      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<x0:prop>');
      expect(xml).toContain('</x0:prop>');

      // No actual properties should be included
      expect(xml).not.toContain('<x0:displayname>');
      expect(xml).not.toContain('<x1:calendar-color>');
    });
  });
});
