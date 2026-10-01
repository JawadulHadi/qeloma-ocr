/**
 * Text from ZIP-based documents — Office Open XML (docx, pptx, xlsx), OpenDocument (odt, odp, ods) and EPUB —
 * by unzipping in memory and walking the XML. Elements are matched by local name, so any namespace prefix works.
 */
import { strFromU8, unzipSync, type Unzipped } from 'fflate';
import { MIME } from './detect';
import { elementToText, normalizeText } from './text';

export interface OfficePage {
  text: string;
}

export interface OfficeResult {
  pages: OfficePage[];
  warnings: string[];
}

const DAMAGED = "This file couldn't be opened. It may be damaged.";
const TOO_BIG_UNPACKED = 'This file is too large to read once unpacked. Try a smaller file.';

/** Most rows read from one sheet. */
export const MAX_SHEET_ROWS = 5000;
/** Repeated columns beyond this are ignored (ODS files often repeat empty columns up to 16,384). */
const MAX_COLUMNS = 512;
/** Total uncompressed bytes we are willing to inflate, against ZIP bombs. */
const MAX_UNPACKED_BYTES = 200 * 1024 * 1024;

// ---- ZIP & XML helpers --------------------------------------------------------------

function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Unzipped {
  let total = 0;
  try {
    return unzipSync(bytes, {
      filter: (file) => {
        if (!wanted(file.name)) return false;
        total += file.originalSize;
        if (total > MAX_UNPACKED_BYTES) throw new Error(TOO_BIG_UNPACKED);
        return true;
      },
    });
  } catch (err) {
    throw new Error(err instanceof Error && err.message === TOO_BIG_UNPACKED ? TOO_BIG_UNPACKED : DAMAGED);
  }
}

function parseXml(source: Uint8Array | undefined, type: DOMParserSupportedType = 'application/xml'): Document {
  if (!source) throw new Error(DAMAGED);
  const doc = new DOMParser().parseFromString(strFromU8(source), type);
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error(DAMAGED);
  return doc;
}

function byName(root: Document | Element, localName: string): Element[] {
  return Array.from(root.getElementsByTagNameNS('*', localName));
}

function childrenNamed(element: Element, localName: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === localName);
}

/** An attribute by local name, whatever its prefix (r:id, table:name, …). */
function attr(element: Element, localName: string): string | null {
  for (const attribute of element.attributes) {
    if (attribute.localName === localName) return attribute.value;
  }
  return null;
}

/** The r:id of an element. <p:sldId> also has a plain `id`, so only a namespaced `id` counts. */
function relationshipId(element: Element): string | null {
  for (const attribute of element.attributes) {
    if (attribute.localName === 'id' && attribute.namespaceURI) return attribute.value;
  }
  return null;
}

/** Resolves a relationship target against the folder of the part that refers to it. */
function resolvePath(baseDir: string, target: string): string {
  const parts = (target.startsWith('/') ? target.slice(1) : `${baseDir}${target}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(0, slash + 1) : '';
}

function readRelationships(files: Unzipped, relsPath: string, baseDir: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!files[relsPath]) return map;
  for (const rel of byName(parseXml(files[relsPath]), 'Relationship')) {
    const id = rel.getAttribute('Id');
    const target = rel.getAttribute('Target');
    if (id && target && rel.getAttribute('TargetMode') !== 'External') map.set(id, resolvePath(baseDir, target));
  }
  return map;
}

/** Joins non-empty paragraphs, one per line. */
function joinLines(lines: string[]): string {
  return normalizeText(lines.join('\n'));
}

// ---- Word (.docx) ---------------------------------------------------------------------

/** Deleted revisions, field codes and properties carry no visible text. */
const WORD_SKIP = new Set(['del', 'delText', 'instrText', 'rPr', 'pPr', 'sectPr', 'fldData', 'drawing', 'pict']);

function wordRunText(node: Element, out: string[]): void {
  for (const child of node.children) {
    const name = child.localName;
    if (WORD_SKIP.has(name)) continue;
    if (name === 't') out.push(child.textContent ?? '');
    else if (name === 'tab' || name === 'ptab') out.push('\t');
    else if (name === 'br' || name === 'cr') out.push('\n');
    else if (name === 'noBreakHyphen') out.push('-');
    else if (name === 'sym') out.push(' ');
    else if (name === 'txbxContent') out.push(` ${wordBlocks(child).join(' ')} `);
    else wordRunText(child, out);
  }
}

function wordParagraph(p: Element): string {
  const out: string[] = [];
  wordRunText(p, out);
  return out.join('');
}

function wordCell(tc: Element): string {
  return wordBlocks(tc).join(' ').replace(/\s+/g, ' ').trim();
}

/** Paragraphs and table rows of a body-like element, in document order. */
function wordBlocks(container: Element): string[] {
  const lines: string[] = [];
  for (const child of container.children) {
    const name = child.localName;
    if (name === 'p') lines.push(wordParagraph(child));
    else if (name === 'tbl') {
      for (const row of childrenNamed(child, 'tr')) {
        lines.push(childrenNamed(row, 'tc').map(wordCell).join(' | '));
      }
      lines.push('');
    } else if (name === 'sdt' || name === 'sdtContent' || name === 'customXml' || name === 'smartTag') {
      lines.push(...wordBlocks(name === 'sdt' ? (childrenNamed(child, 'sdtContent')[0] ?? child) : child));
    }
  }
  return lines;
}

function wordNotes(files: Unzipped, path: string, noteName: string): string[] {
  if (!files[path]) return [];
  return byName(parseXml(files[path]), noteName)
    .filter((note) => !['separator', 'continuationSeparator', 'continuationNotice'].includes(attr(note, 'type') ?? ''))
    .map((note) => wordBlocks(note).join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export function docxToPages(bytes: Uint8Array): OfficeResult {
  const files = unzip(bytes, (name) => /^word\/(document|footnotes|endnotes)\.xml$/.test(name));
  const doc = parseXml(files['word/document.xml']);
  const body = byName(doc, 'body')[0];
  if (!body) throw new Error(DAMAGED);
  const lines = wordBlocks(body);
  const notes = [...wordNotes(files, 'word/footnotes.xml', 'footnote'), ...wordNotes(files, 'word/endnotes.xml', 'endnote')];
  if (notes.length > 0) lines.push('', 'Notes', ...notes.map((note, index) => `${index + 1}. ${note}`));
  return { pages: [{ text: joinLines(lines) }], warnings: [] };
}

// ---- PowerPoint (.pptx) -------------------------------------------------------------------

function drawingParagraphs(root: Element | Document): string {
  return joinLines(
    byName(root, 'p')
      .filter((p) => p.namespaceURI?.includes('drawingml'))
      .map((p) => {
        const out: string[] = [];
        for (const node of p.getElementsByTagNameNS('*', '*')) {
          if (node.localName === 't') out.push(node.textContent ?? '');
          else if (node.localName === 'br') out.push('\n');
        }
        return out.join('');
      }),
  );
}

function slideNumber(path: string): number {
  return Number(/(\d+)\.xml$/.exec(path)?.[1] ?? 0);
}

/** Slide paths in presentation order, falling back to their file numbers. */
function slideOrder(files: Unzipped): string[] {
  const slides = Object.keys(files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name));
  const byNumber = [...slides].sort((a, b) => slideNumber(a) - slideNumber(b));
  if (!files['ppt/presentation.xml']) return byNumber;
  const rels = readRelationships(files, 'ppt/_rels/presentation.xml.rels', 'ppt/');
  const ordered = byName(parseXml(files['ppt/presentation.xml']), 'sldId')
    .map((sldId) => rels.get(relationshipId(sldId) ?? ''))
    .filter((path): path is string => path !== undefined && files[path] !== undefined);
  return ordered.length > 0 ? ordered : byNumber;
}

export function pptxToPages(bytes: Uint8Array): OfficeResult {
  const files = unzip(bytes, (name) => /^ppt\/(presentation\.xml|_rels\/presentation\.xml\.rels|slides\/slide\d+\.xml)$/.test(name));
  const pages = slideOrder(files).map((path) => ({ text: drawingParagraphs(parseXml(files[path])) }));
  if (pages.length === 0) throw new Error('This presentation has no slides.');
  return { pages, warnings: [] };
}

// ---- Excel (.xlsx) --------------------------------------------------------------------------

/** "C12" → 2 (0-based column index). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/i.exec(ref)?.[0].toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** Joins cells with tabs, dropping empty cells at the end of the row. */
function rowText(cells: string[]): string {
  let end = cells.length;
  while (end > 0 && cells[end - 1].trim() === '') end -= 1;
  return cells.slice(0, end).map((cell) => cell.replace(/\s*\n\s*/g, ' ')).join('\t');
}

function sharedStrings(files: Unzipped): string[] {
  const source = files['xl/sharedStrings.xml'];
  if (!source) return [];
  return byName(parseXml(source), 'si').map((si) =>
    byName(si, 't')
      // Phonetic guides (rPh) repeat the text in another script.
      .filter((t) => t.parentElement?.localName !== 'rPh')
      .map((t) => t.textContent ?? '')
      .join(''),
  );
}

function cellValue(cell: Element, strings: string[]): string {
  const type = cell.getAttribute('t');
  const value = childrenNamed(cell, 'v')[0]?.textContent ?? '';
  switch (type) {
    case 's':
      return strings[Number(value)] ?? '';
    case 'inlineStr':
      return byName(cell, 't').map((t) => t.textContent ?? '').join('');
    case 'b':
      return value === '1' ? 'TRUE' : 'FALSE';
    default:
      return value;
  }
}

export function xlsxToPages(bytes: Uint8Array): OfficeResult {
  const files = unzip(bytes, (name) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(name));
  const strings = sharedStrings(files);
  const rels = readRelationships(files, 'xl/_rels/workbook.xml.rels', 'xl/');
  const sheets = byName(parseXml(files['xl/workbook.xml']), 'sheet');
  const pages: OfficePage[] = [];
  const warnings: string[] = [];

  for (const sheet of sheets) {
    const name = sheet.getAttribute('name') ?? `Sheet ${pages.length + 1}`;
    const path = rels.get(relationshipId(sheet) ?? '');
    if (!path || !files[path]) continue;
    const lines: string[] = [];
    const rows = byName(parseXml(files[path]), 'row');
    for (const row of rows) {
      if (lines.length >= MAX_SHEET_ROWS) {
        warnings.push(`Sheet “${name}”: only the first ${MAX_SHEET_ROWS.toLocaleString('en-US')} rows were read.`);
        break;
      }
      const cells: string[] = [];
      childrenNamed(row, 'c').forEach((cell, position) => {
        const ref = cell.getAttribute('r');
        const column = ref ? columnIndex(ref) : position;
        if (column < 0 || column >= MAX_COLUMNS) return;
        while (cells.length < column) cells.push('');
        cells[column] = cellValue(cell, strings);
      });
      const text = rowText(cells);
      if (text) lines.push(text);
    }
    pages.push({ text: joinLines([`Sheet: ${name}`, ...lines]) });
  }
  if (pages.length === 0) throw new Error(DAMAGED);
  return { pages, warnings };
}

// ---- OpenDocument (.odt, .odp, .ods) ------------------------------------------------------

const ODF_SKIP = new Set(['note', 'annotation', 'annotation-end', 'tracked-changes', 'bookmark', 'soft-page-break']);

function odfInline(node: Element, out: string[]): void {
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      out.push((child.nodeValue ?? '').replace(/\s+/g, ' '));
      continue;
    }
    if (child.nodeType !== 1) continue;
    const element = child as Element;
    const name = element.localName;
    if (ODF_SKIP.has(name)) continue;
    if (name === 's') out.push(' '.repeat(Math.min(Number(attr(element, 'c') ?? '1') || 1, 64)));
    else if (name === 'tab') out.push('\t');
    else if (name === 'line-break') out.push('\n');
    else odfInline(element, out);
  }
}

function odfParagraph(element: Element): string {
  const out: string[] = [];
  odfInline(element, out);
  return out.join('').trim();
}

function repeat(element: Element, localName: string, cap: number): number {
  return Math.min(Math.max(Number(attr(element, localName) ?? '1') || 1, 1), cap);
}

/** Rows that belong to `table` itself (inside row groups too), not to a table nested in one of its cells. */
function ownRows(table: Element): Element[] {
  return byName(table, 'table-row').filter((row) => nearestAncestor(row, 'table') === table);
}

function nearestAncestor(element: Element, localName: string): Element | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    if (parent.localName === localName) return parent;
  }
  return null;
}

/** Spreadsheet rows as tab-separated lines, expanding repeated rows and columns up to the caps. */
function odsRows(table: Element, maxRows: number, onTruncated: () => void): string[] {
  const lines: string[] = [];
  for (const row of ownRows(table)) {
    const cells: string[] = [];
    for (const cell of row.children) {
      if (cell.localName !== 'table-cell' && cell.localName !== 'covered-table-cell') continue;
      const text = childrenNamed(cell, 'p').map(odfParagraph).join(' ');
      const count = repeat(cell, 'number-columns-repeated', MAX_COLUMNS);
      for (let i = 0; i < count && cells.length < MAX_COLUMNS; i += 1) cells.push(text);
    }
    const text = rowText(cells);
    if (!text) continue;
    const count = repeat(row, 'number-rows-repeated', maxRows);
    for (let i = 0; i < count; i += 1) {
      if (lines.length >= maxRows) {
        onTruncated();
        return lines;
      }
      lines.push(text);
    }
  }
  return lines;
}

/** Headings, paragraphs, lists, sections and tables of an ODF text body, in document order. */
function odfBlocks(container: Element): string[] {
  const lines: string[] = [];
  for (const child of container.children) {
    const name = child.localName;
    if (name === 'p' || name === 'h') lines.push(odfParagraph(child));
    else if (name === 'list') {
      for (const item of childrenNamed(child, 'list-item')) {
        const [first, ...rest] = odfBlocks(item);
        if (first !== undefined) lines.push(`• ${first}`, ...rest);
      }
    } else if (name === 'table') {
      for (const row of ownRows(child)) {
        const cells = Array.from(row.children)
          .filter((cell) => cell.localName === 'table-cell')
          .map((cell) => odfBlocks(cell).join(' ').trim());
        lines.push(cells.join(' | '));
      }
      lines.push('');
    } else if (['section', 'list-header', 'index-body', 'table-of-content', 'frame', 'text-box'].includes(name)) {
      lines.push(...odfBlocks(child));
    }
  }
  return lines;
}

function odfContent(bytes: Uint8Array): Document {
  return parseXml(unzip(bytes, (name) => name === 'content.xml')['content.xml']);
}

export function odtToPages(bytes: Uint8Array): OfficeResult {
  const body = byName(odfContent(bytes), 'text').find((element) => element.parentElement?.localName === 'body');
  if (!body) throw new Error(DAMAGED);
  return { pages: [{ text: joinLines(odfBlocks(body)) }], warnings: [] };
}

export function odpToPages(bytes: Uint8Array): OfficeResult {
  const pages = byName(odfContent(bytes), 'page').map((page) => {
    const paragraphs = byName(page, '*').filter(
      (element) => (element.localName === 'p' || element.localName === 'h') && nearestAncestor(element, 'notes') === null,
    );
    return { text: joinLines(paragraphs.map(odfParagraph)) };
  });
  if (pages.length === 0) throw new Error('This presentation has no slides.');
  return { pages, warnings: [] };
}

export function odsToPages(bytes: Uint8Array): OfficeResult {
  const warnings: string[] = [];
  const tables = byName(odfContent(bytes), 'table').filter((table) => table.parentElement?.localName === 'spreadsheet');
  const pages = tables.map((table, index) => {
    const name = attr(table, 'name') ?? `Sheet ${index + 1}`;
    const rows = odsRows(table, MAX_SHEET_ROWS, () =>
      warnings.push(`Sheet “${name}”: only the first ${MAX_SHEET_ROWS.toLocaleString('en-US')} rows were read.`),
    );
    return { text: joinLines([`Sheet: ${name}`, ...rows]) };
  });
  if (pages.length === 0) throw new Error(DAMAGED);
  return { pages, warnings };
}

// ---- EPUB ------------------------------------------------------------------------------------

export function epubToPages(bytes: Uint8Array): OfficeResult {
  const files = unzip(bytes, (name) => !/\.(png|jpe?g|gif|webp|svg|ttf|otf|woff2?|mp3|mp4|m4a)$/i.test(name));
  const container = parseXml(files['META-INF/container.xml']);
  const opfPath = byName(container, 'rootfile')[0]?.getAttribute('full-path');
  if (!opfPath) throw new Error(DAMAGED);
  const opf = parseXml(files[opfPath]);
  const baseDir = dirOf(opfPath);

  const manifest = new Map<string, string>();
  for (const item of byName(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, resolvePath(baseDir, decodeURIComponent(href.split('#')[0])));
  }

  const pages: OfficePage[] = [];
  for (const itemref of byName(opf, 'itemref')) {
    if (itemref.getAttribute('linear') === 'no') continue;
    const path = manifest.get(itemref.getAttribute('idref') ?? '');
    const source = path ? files[path] : undefined;
    if (!source) continue;
    let doc: Document;
    try {
      doc = parseXml(source, 'application/xhtml+xml');
    } catch {
      doc = new DOMParser().parseFromString(strFromU8(source), 'text/html');
    }
    const body = byName(doc, 'body')[0] ?? doc.documentElement;
    const text = elementToText(body);
    if (text) pages.push({ text });
  }
  if (pages.length === 0) throw new Error('No readable chapters were found in this book.');
  return { pages, warnings: [] };
}

// ---- Router ------------------------------------------------------------------------------------

export function officeToPages(bytes: Uint8Array, mimeType: string): OfficeResult {
  switch (mimeType) {
    case MIME.docx:
      return docxToPages(bytes);
    case MIME.pptx:
      return pptxToPages(bytes);
    case MIME.xlsx:
      return xlsxToPages(bytes);
    case MIME.odt:
      return odtToPages(bytes);
    case MIME.odp:
      return odpToPages(bytes);
    case MIME.ods:
      return odsToPages(bytes);
    case MIME.epub:
      return epubToPages(bytes);
    default:
      throw new Error(DAMAGED);
  }
}
