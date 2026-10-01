/** Plain-text decoding and clean-up shared by every extractor. */

/** Decodes bytes using the BOM when there is one; otherwise strict UTF-8, falling back to Windows-1252. */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Unix line endings, no trailing spaces, at most one blank line in a row, trimmed. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replaceAll('\0', '')
    .replaceAll('﻿', '')
    .replace(/[ \t ]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const SKIPPED_ELEMENTS = new Set(['script', 'style', 'noscript', 'template', 'head', 'svg', 'math', 'iframe', 'object']);
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'dd', 'details', 'dialog', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
  'main', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul', 'caption',
]);

/** Visible text of an HTML/XHTML element: block elements break lines, table cells are separated by " | ". */
export function elementToText(root: Element): string {
  const out: string[] = [];

  const walk = (node: Node, inPre: boolean) => {
    if (node.nodeType === 3) {
      const value = node.nodeValue ?? '';
      out.push(inPre ? value : value.replace(/\s+/g, ' '));
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const name = element.localName.toLowerCase();
    if (SKIPPED_ELEMENTS.has(name) || element.hasAttribute('hidden')) return;
    if (name === 'br') {
      out.push('\n');
      return;
    }
    if (name === 'td' || name === 'th') {
      if (element.previousElementSibling) out.push(' | ');
    }
    const block = BLOCK_ELEMENTS.has(name);
    if (block) out.push('\n');
    if (name === 'li') out.push('• ');
    if (name === 'img') {
      const alt = element.getAttribute('alt')?.trim();
      if (alt) out.push(` ${alt} `);
    }
    for (const child of element.childNodes) walk(child, inPre || name === 'pre');
    if (block) out.push('\n');
  };

  walk(root, false);
  return normalizeText(
    out
      .join('')
      .split('\n')
      .map((line) => line.replace(/^ +| +$/g, ''))
      .join('\n'),
  );
}

export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return elementToText(doc.body ?? doc.documentElement);
}

/** The text to analyze for a text-like file: HTML is reduced to its visible text, valid JSON is pretty-printed. */
export function textFileToText(raw: string, mimeType: string): string {
  if (mimeType === 'text/html') return htmlToText(raw);
  if (mimeType === 'application/json') {
    try {
      return normalizeText(JSON.stringify(JSON.parse(raw), null, 2));
    } catch {
      // Not valid JSON after all: show it as it is.
    }
  }
  return normalizeText(raw);
}

/** Count of characters that aren't whitespace — used to tell a real text layer from a scanned page. */
export function visibleLength(text: string): number {
  return text.replace(/\s+/g, '').length;
}
