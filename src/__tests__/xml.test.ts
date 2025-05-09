import { escapeXml, createXmlElement, escapeXmlAttribute } from '../utils/xml.js';

describe('XML Utility Functions', () => {
  describe('escapeXml', () => {
    it('should escape special XML characters', () => {
      const input = 'Test & "quotes" and <tags> with \'apostrophes\'';
      const expected =
        'Test &amp; &quot;quotes&quot; and &lt;tags&gt; with &apos;apostrophes&apos;';
      expect(escapeXml(input)).toBe(expected);
    });

    it('should handle empty strings', () => {
      expect(escapeXml('')).toBe('');
    });

    it('should handle null and undefined inputs', () => {
      expect(escapeXml(null)).toBe('');
      expect(escapeXml(undefined)).toBe('');
    });

    it('should handle strings with multiple special characters', () => {
      const input = '<script>alert("XSS & Injection")</script>';
      const expected = '&lt;script&gt;alert(&quot;XSS &amp; Injection&quot;)&lt;/script&gt;';
      expect(escapeXml(input)).toBe(expected);
    });
  });

  describe('createXmlElement', () => {
    it('should create a well-formed XML element with escaped content', () => {
      const tagName = 'displayname';
      const content = 'Calendar & <Events>';
      const expected = '<displayname>Calendar &amp; &lt;Events&gt;</displayname>';
      expect(createXmlElement(tagName, content)).toBe(expected);
    });

    it('should handle empty content', () => {
      expect(createXmlElement('empty', '')).toBe('<empty></empty>');
    });

    it('should handle null and undefined content', () => {
      expect(createXmlElement('null', null)).toBe('<null></null>');
      expect(createXmlElement('undefined', undefined)).toBe('<undefined></undefined>');
    });
  });

  describe('escapeXmlAttribute', () => {
    it('should escape attribute values', () => {
      const input = 'value="dangerous"';
      const expected = 'value=&quot;dangerous&quot;';
      expect(escapeXmlAttribute(input)).toBe(expected);
    });

    it('should handle null and undefined inputs', () => {
      expect(escapeXmlAttribute(null)).toBe('');
      expect(escapeXmlAttribute(undefined)).toBe('');
    });
  });
});
