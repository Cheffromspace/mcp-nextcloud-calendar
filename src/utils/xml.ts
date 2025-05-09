/**
 * Utilities for working with XML in a safe manner
 */

/**
 * Escapes a string for safe use in XML content.
 * Handles the five predefined XML entities:
 * - & (ampersand) becomes &amp;
 * - < (less than) becomes &lt;
 * - > (greater than) becomes &gt;
 * - " (double quote) becomes &quot;
 * - ' (apostrophe) becomes &apos;
 *
 * @param input The string to escape
 * @returns The XML-escaped string
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
 * Creates a safe XML fragment from user input
 *
 * @param tagName The XML tag name
 * @param content The content to place within the tag
 * @returns A properly escaped XML fragment
 */
export function createXmlElement(tagName: string, content: string | null | undefined): string {
  return `<${tagName}>${escapeXml(content)}</${tagName}>`;
}

/**
 * Escapes a string for use as an XML attribute value
 *
 * @param value The attribute value to escape
 * @returns The escaped attribute value (without quotes)
 */
export function escapeXmlAttribute(value: string | null | undefined): string {
  return escapeXml(value);
}
