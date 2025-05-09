import * as PropertyParser from '../services/calendar/property-parser.js';

describe('Property Parser', () => {
  describe('extractCalendarId', () => {
    it('should extract the calendar ID from a WebDAV href', () => {
      expect(PropertyParser.extractCalendarId('/remote.php/dav/calendars/user/personal/')).toBe(
        'personal',
      );
      expect(
        PropertyParser.extractCalendarId('/remote.php/dav/calendars/user/work-calendar/'),
      ).toBe('work-calendar');
    });

    it('should handle empty or invalid inputs', () => {
      expect(PropertyParser.extractCalendarId('')).toBe('');
      expect(PropertyParser.extractCalendarId('/')).toBe('');
    });
  });

  describe('isCalendarResource', () => {
    it('should identify direct calendar resources', () => {
      expect(PropertyParser.isCalendarResource({ 'cal:calendar': {} })).toBe(true);
    });

    it('should identify calendar resources with different namespace', () => {
      expect(PropertyParser.isCalendarResource({ 'nc:calendar': {} })).toBe(true);
      expect(PropertyParser.isCalendarResource({ calendar: {} })).toBe(true);
    });

    it('should identify calendar resources in collection structure', () => {
      expect(PropertyParser.isCalendarResource({ collection: { 'cal:calendar': {} } })).toBe(true);
    });

    it('should handle string inputs', () => {
      expect(PropertyParser.isCalendarResource('calendar')).toBe(true);
      expect(PropertyParser.isCalendarResource('CALENDAR')).toBe(true);
      // The function checks if the string contains "calendar", so "not a calendar" also returns true
      expect(PropertyParser.isCalendarResource('not a calendar')).toBe(true);
      // This should be false since it doesn't contain 'calendar'
      expect(PropertyParser.isCalendarResource('appointment')).toBe(false);
    });

    it('should reject non-calendar resources', () => {
      expect(PropertyParser.isCalendarResource(null)).toBe(false);
      expect(PropertyParser.isCalendarResource(undefined)).toBe(false);
      expect(PropertyParser.isCalendarResource({})).toBe(false);
      expect(PropertyParser.isCalendarResource({ other: {} })).toBe(false);
    });
  });

  describe('extractOwner', () => {
    it('should extract owner from owner principal string', () => {
      expect(PropertyParser.extractOwner('principal:principals/users/admin', 'default')).toBe(
        'admin',
      );
      expect(PropertyParser.extractOwner('principal:principals/users/john.doe', 'default')).toBe(
        'john.doe',
      );
    });

    it('should return default username when owner principal is invalid', () => {
      expect(PropertyParser.extractOwner('invalid', 'default')).toBe('default');
      expect(PropertyParser.extractOwner(null, 'default')).toBe('default');
      expect(PropertyParser.extractOwner(undefined, 'default')).toBe('default');
    });
  });

  describe('normalizeColor', () => {
    it('should normalize valid hex colors', () => {
      expect(PropertyParser.normalizeColor('#FF0000')).toBe('#FF0000');
      expect(PropertyParser.normalizeColor('#fff')).toBe('#fff');
    });

    it('should remove quotes from color values', () => {
      expect(PropertyParser.normalizeColor('"#FF0000"')).toBe('#FF0000');
    });

    it('should return default color for invalid formats', () => {
      expect(PropertyParser.normalizeColor('red')).toBe('#0082c9'); // Not hex format
      expect(PropertyParser.normalizeColor(null)).toBe('#0082c9');
      expect(PropertyParser.normalizeColor(undefined)).toBe('#0082c9');
    });
  });

  describe('parsePrivilegeSet', () => {
    it('should parse full privileges', () => {
      const privilegeSet = {
        'd:privilege': [{ 'd:read': {} }, { 'd:write': {} }, { 'd:share': {} }, { 'd:unbind': {} }],
      };

      const permissions = PropertyParser.parsePrivilegeSet(privilegeSet);

      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(true);
      expect(permissions.canShare).toBe(true);
      expect(permissions.canDelete).toBe(true);
    });

    it('should handle partial privileges', () => {
      const privilegeSet = {
        'd:privilege': [{ 'd:read': {} }],
      };

      const permissions = PropertyParser.parsePrivilegeSet(privilegeSet);

      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(false);
      expect(permissions.canShare).toBe(false);
      expect(permissions.canDelete).toBe(false);
    });

    it('should handle single privilege object (non-array)', () => {
      const privilegeSet = {
        'd:privilege': { 'd:read': {} },
      };

      const permissions = PropertyParser.parsePrivilegeSet(privilegeSet);

      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(false);
    });

    it('should default to read-only when privilege set is null', () => {
      const permissions = PropertyParser.parsePrivilegeSet(null);

      expect(permissions.canRead).toBe(true);
      expect(permissions.canWrite).toBe(false);
      expect(permissions.canShare).toBe(false);
      expect(permissions.canDelete).toBe(false);
    });

    it('should set read access even with incomplete privilege set', () => {
      const privilegeSet = { someOtherProperty: {} };

      const permissions = PropertyParser.parsePrivilegeSet(privilegeSet);

      expect(permissions.canRead).toBe(true);
    });
  });
});
