# XML Processing

This document covers migrating XML processing from Express.js to Cloudflare Workers.

## XML Processing Challenges

XML processing is a critical component of the Nextcloud Calendar integration, particularly for CalDAV communication. There are two main approaches to handle XML in Cloudflare Workers:

### Option 1: Use Node.js Compatibility

This approach minimizes code changes by using the existing `xml2js` library with Node.js compatibility mode:

```toml
# wrangler.toml
compatibility_flags = ["nodejs_compat"]
```

This approach has the advantage of requiring minimal code changes but may have performance implications in the Workers environment.

### Option 2: Use Web Standard APIs

The recommended approach for long-term performance is to replace `xml2js` with DOM-based parsing using web standard APIs:

```typescript
export class WebXmlService {
  // Parse XML using DOMParser (web standard)
  async parseXml(xmlString: string, options: ParseOptions = {}): Promise<Record<string, unknown>> {
    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "application/xml");
      
      // Check for parsing errors
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        throw new XmlParsingError(
          `XML parsing failed: ${parserError.textContent}`,
          xmlString,
          options,
          new Error(parserError.textContent || "Unknown parsing error"),
          false
        );
      }
      
      // Convert DOM to object structure
      return this.domToObject(xmlDoc);
    } catch (error) {
      throw new XmlParsingError(
        `XML parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        xmlString,
        options,
        error,
        false
      );
    }
  }
  
  // Convert DOM to object structure (similar to xml2js output)
  private domToObject(node: Node): Record<string, unknown> {
    // Handle non-element nodes
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue ? { "#text": node.nodeValue } : {};
    }
    
    if (node.nodeType === Node.CDATA_SECTION_NODE) {
      return { "#cdata": node.nodeValue };
    }
    
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return {};
    }
    
    const element = node as Element;
    const result: Record<string, unknown> = {};
    let textContent = "";
    
    // Handle attributes
    if (element.attributes.length > 0) {
      result["$"] = {};
      for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        (result["$"] as Record<string, string>)[attr.name] = attr.value;
      }
    }
    
    // Handle child nodes
    const childNodes = Array.from(element.childNodes);
    if (childNodes.length === 0) {
      return result;
    }
    
    // Check for mixed content (text nodes and elements mixed together)
    let hasTextContent = false;
    let hasElementContent = false;
    
    for (const child of childNodes) {
      if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
        if (child.nodeValue && child.nodeValue.trim()) {
          hasTextContent = true;
          textContent += child.nodeValue;
        }
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        hasElementContent = true;
      }
    }
    
    // If only text content, return it directly
    if (hasTextContent && !hasElementContent) {
      result["#text"] = textContent;
      return result;
    }
    
    // Process all child nodes for mixed content
    for (const child of childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const childElement = child as Element;
        const childName = childElement.nodeName;
        const childResult = this.domToObject(child);
        
        if (result[childName]) {
          // Convert to array if multiple elements with same name
          if (!Array.isArray(result[childName])) {
            result[childName] = [result[childName]];
          }
          (result[childName] as Array<unknown>).push(childResult);
        } else {
          result[childName] = childResult;
        }
      } else if (child.nodeType === Node.CDATA_SECTION_NODE) {
        // Handle CDATA sections
        if (!result["#cdata"]) {
          result["#cdata"] = [];
        }
        (result["#cdata"] as Array<string>).push(child.nodeValue || "");
      } else if (child.nodeType === Node.TEXT_NODE && child.nodeValue && child.nodeValue.trim()) {
        // Handle significant text in mixed content
        if (!result["#text"]) {
          result["#text"] = [];
        }
        (result["#text"] as Array<string>).push(child.nodeValue.trim());
      }
    }
    
    return result;
  }
  
  // Serializing DOM to string
  serializeToString(document: Document): string {
    const serializer = new XMLSerializer();
    return serializer.serializeToString(document);
  }
}
```

## XML Document Building

The existing document builder pattern can be adapted for Web APIs:

```typescript
export class WebXmlDocumentBuilder {
  private xmlService: WebXmlService;
  private doc: Document;
  private currentElement: Element;
  private rootElement: Element;
  
  constructor(xmlService: WebXmlService, rootElementName: string, namespaces?: Record<string, string>) {
    this.xmlService = xmlService;
    
    // Create document and root element
    this.doc = new DOMParser().parseFromString('<?xml version="1.0" encoding="UTF-8"?>', 'application/xml');
    this.rootElement = this.doc.createElement(rootElementName);
    this.doc.appendChild(this.rootElement);
    this.currentElement = this.rootElement;
    
    // Add namespaces if provided
    if (namespaces) {
      for (const [prefix, uri] of Object.entries(namespaces)) {
        this.rootElement.setAttribute(`xmlns:${prefix}`, uri);
      }
    }
  }
  
  startElement(name: string): WebXmlDocumentBuilder {
    const element = this.doc.createElement(name);
    this.currentElement.appendChild(element);
    this.currentElement = element;
    return this;
  }
  
  endElement(): WebXmlDocumentBuilder {
    if (this.currentElement.parentElement) {
      this.currentElement = this.currentElement.parentElement;
    }
    return this;
  }
  
  addElement(name: string, content: string | null | undefined): WebXmlDocumentBuilder {
    this.startElement(name);
    if (content !== null && content !== undefined) {
      this.currentElement.textContent = content;
    }
    return this.endElement();
  }
  
  addEmptyElement(name: string): WebXmlDocumentBuilder {
    const element = this.doc.createElement(name);
    this.currentElement.appendChild(element);
    return this;
  }
  
  addAttribute(name: string, value: string): WebXmlDocumentBuilder {
    this.currentElement.setAttribute(name, value);
    return this;
  }
  
  setContent(content: string): WebXmlDocumentBuilder {
    this.currentElement.textContent = content;
    return this;
  }
  
  toString(includeDeclaration: boolean = false): string {
    const serializer = new XMLSerializer();
    const xmlString = serializer.serializeToString(this.rootElement);
    
    if (includeDeclaration) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n${xmlString}`;
    }
    
    return xmlString;
  }
  
  dispose(): void {
    // Clean up references
    this.currentElement = null;
    this.rootElement = null;
    this.doc = null;
  }
}
```

## CalDAV XML Builder

For CalDAV-specific XML building, adapt the existing builder:

```typescript
export class WebCalDavXmlBuilder {
  private xmlService: WebXmlService;
  
  /**
   * Standard namespaces used in CalDAV requests
   */
  private static readonly NAMESPACES = {
    d: 'DAV:',
    c: 'urn:ietf:params:xml:ns:caldav',
    cs: 'http://calendarserver.org/ns/',
    oc: 'http://owncloud.org/ns',
    x1: 'http://apple.com/ns/ical/',
  };
  
  constructor(xmlService: WebXmlService) {
    this.xmlService = xmlService;
  }
  
  buildPropfindRequest(properties?: string[]): string {
    // Use default properties if none provided
    const props = properties || [
      'd:resourcetype',
      'd:displayname',
      'cal:supported-calendar-component-set',
      'cs:getctag',
      'oc:calendar-enabled',
      'd:sync-token',
      'oc:owner-principal',
      'd:current-user-privilege-set',
      'oc:invite',
      'oc:calendar-order',
      'd:color',
    ];
    
    const builder = new WebXmlDocumentBuilder(this.xmlService, 'd:propfind', WebCalDavXmlBuilder.NAMESPACES);
    const propElement = builder.startElement('d:prop');
    
    for (const property of props) {
      propElement.addEmptyElement(property);
    }
    
    try {
      return builder.toString(true);
    } finally {
      builder.dispose();
    }
  }
  
  // Additional methods follow similar pattern...
}
```

## XML Security Considerations

### XXE Attacks Prevention

Disable external entity processing to prevent XML External Entity (XXE) attacks:

```typescript
private parseXmlSafely(xmlString: string): Document {
  // Use DOMParser with XXE protections
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, "application/xml");
  
  // Check for parsing errors
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) {
    throw new Error(`XML parsing failed: ${parserError.textContent}`);
  }
  
  // Additional XXE prevention - check for DOCTYPE
  if (xmlDoc.doctype) {
    throw new Error("DOCTYPE is not allowed for security reasons");
  }
  
  return xmlDoc;
}
```

### XML Bomb Prevention

Implement entity expansion limits to prevent billion laughs attacks:

```typescript
// In a real implementation, you would need to check for excessive entity expansion
// This is a simplified example that rejects any XML with entity definitions
private checkForXmlBomb(xmlString: string): void {
  if (xmlString.includes("<!ENTITY")) {
    throw new Error("XML entity definitions are not allowed for security reasons");
  }
}
```

### Input Sanitization

Always sanitize XML input and output:

```typescript
// Escapes a string for safe use in XML content
escapeXml(input: string | null | undefined): string {
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
```

## Integration Testing

Test your XML processing implementation:

```typescript
import { describe, test, expect } from 'vitest';
import { WebXmlService } from '../src/services/xml/web-xml-service';

describe('WebXmlService', () => {
  test('should parse XML correctly', async () => {
    const xmlService = new WebXmlService();
    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <d:multistatus xmlns:d="DAV:">
        <d:response>
          <d:href>/calendars/user/test/</d:href>
          <d:propstat>
            <d:prop>
              <d:displayname>Test Calendar</d:displayname>
            </d:prop>
            <d:status>HTTP/1.1 200 OK</d:status>
          </d:propstat>
        </d:response>
      </d:multistatus>`;
    
    const result = await xmlService.parseXml(xmlString);
    expect(result).toHaveProperty('d:multistatus');
  });
  
  test('should properly handle CDATA sections', async () => {
    const xmlService = new WebXmlService();
    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <calendar>
        <description><![CDATA[This is a <strong>formatted</strong> description]]></description>
      </calendar>`;
    
    const result = await xmlService.parseXml(xmlString);
    expect(result).toHaveProperty('calendar');
    expect(result.calendar).toHaveProperty('description');
    expect(result.calendar.description).toHaveProperty('#cdata');
  });
  
  test('should handle mixed content correctly', async () => {
    const xmlService = new WebXmlService();
    const xmlString = `<?xml version="1.0" encoding="UTF-8"?>
      <item>Text before <em>emphasized</em> and text after</item>`;
    
    const result = await xmlService.parseXml(xmlString);
    expect(result.item).toHaveProperty('#text');
    expect(result.item).toHaveProperty('em');
  });
  
  test('should prevent XXE attacks', async () => {
    const xmlService = new WebXmlService();
    const maliciousXml = `<?xml version="1.0" encoding="UTF-8"?>
      <!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
      <calendar>
        <name>&xxe;</name>
      </calendar>`;
    
    await expect(xmlService.parseXml(maliciousXml)).rejects.toThrow();
  });
});
```

## Recommended Migration Approach

1. **Start with Option 1 (Node.js compatibility)** for faster migration
2. **Profile performance** and gradually implement Option 2 for critical paths
3. **Create adapter classes** to maintain the same interface for both approaches

With this migration strategy, you can ensure a smooth transition while addressing performance concerns over time.

## Next Steps

Once you have migrated your XML processing, proceed to adapt the calendar services as described in [Calendar Services](./05-calendar-services.md).