import { strFromU8, unzipSync } from 'fflate';
import { MAX_UPLOAD_BYTES } from '../../../shared/limits';
import { UnsupportedFileError, type DetectedFile } from './types';

/** Value for `<input type="file" accept>`: MIME types plus extensions, because Windows often reports no type. */
export const ACCEPT_ATTR = [
  'image/*',
  '.heic',
  '.heif',
  '.avif',
  '.tif',
  '.tiff',
  '.svg',
  'application/pdf',
  '.pdf',
  '.docx',
  '.pptx',
  '.xlsx',
  '.odt',
  '.odp',
  '.ods',
  '.epub',
  '.rtf',
  'text/*',
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.tsv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.log',
  '.yaml',
  '.yml',
  '.ini',
].join(',');

export const SUPPORTED_GROUPS: { label: string; examples: string[] }[] = [
  { label: 'Images', examples: ['PNG', 'JPEG', 'WebP', 'HEIC', 'TIFF', 'GIF', 'BMP', 'AVIF', 'SVG'] },
  { label: 'PDF', examples: ['Digital', 'Scanned'] },
  { label: 'Office & OpenDocument', examples: ['DOCX', 'PPTX', 'XLSX', 'ODT', 'ODP', 'ODS', 'EPUB', 'RTF'] },
  { label: 'Text & web', examples: ['TXT', 'Markdown', 'CSV', 'JSON', 'HTML', 'XML'] },
];

export const MIME = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  odt: 'application/vnd.oasis.opendocument.text',
  odp: 'application/vnd.oasis.opendocument.presentation',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  epub: 'application/epub+zip',
  rtf: 'application/rtf',
  pdf: 'application/pdf',
  svg: 'image/svg+xml',
} as const;

const UNSUPPORTED =
  "Scanwise can't read this type of file. Try an image (PNG, JPEG, HEIC, TIFF…), a PDF, an Office or OpenDocument file, or a text file.";
const LEGACY_OFFICE =
  "Older .doc, .xls and .ppt files aren't supported. Save it as .docx, .xlsx, .pptx or PDF and upload it again.";
const PROTECTED_OFFICE = 'This file is password-protected. Remove the password and upload it again.';
const DAMAGED_ZIP = "This file couldn't be opened. It may be damaged.";

/** Bytes inspected for magic numbers and text heuristics. */
const HEAD_BYTES = 8192;

interface TextType {
  mimeType: string;
  label: string;
}

const TEXT_TYPES: Record<string, TextType> = {
  txt: { mimeType: 'text/plain', label: 'Plain text' },
  text: { mimeType: 'text/plain', label: 'Plain text' },
  md: { mimeType: 'text/markdown', label: 'Markdown' },
  markdown: { mimeType: 'text/markdown', label: 'Markdown' },
  csv: { mimeType: 'text/csv', label: 'CSV' },
  tsv: { mimeType: 'text/tab-separated-values', label: 'TSV' },
  json: { mimeType: 'application/json', label: 'JSON' },
  xml: { mimeType: 'application/xml', label: 'XML' },
  html: { mimeType: 'text/html', label: 'HTML page' },
  htm: { mimeType: 'text/html', label: 'HTML page' },
  log: { mimeType: 'text/plain', label: 'Log file' },
  yaml: { mimeType: 'application/yaml', label: 'YAML' },
  yml: { mimeType: 'application/yaml', label: 'YAML' },
  ini: { mimeType: 'text/plain', label: 'Settings file' },
};

const TEXT_BY_MIME: Record<string, TextType> = {
  'text/markdown': TEXT_TYPES.md,
  'text/csv': TEXT_TYPES.csv,
  'text/tab-separated-values': TEXT_TYPES.tsv,
  'application/json': TEXT_TYPES.json,
  'application/xml': TEXT_TYPES.xml,
  'text/xml': TEXT_TYPES.xml,
  'text/html': TEXT_TYPES.html,
  'application/xhtml+xml': TEXT_TYPES.html,
  'application/yaml': TEXT_TYPES.yaml,
  'text/yaml': TEXT_TYPES.yaml,
};

export function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name);
  return match ? match[1].toLowerCase() : '';
}

export function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function image(mimeType: string, label: string, ext: string): DetectedFile {
  return { kind: 'image', mimeType, label, ext };
}

/** Magic numbers for images and PDF. ISO-BMFF (HEIC/AVIF) is told apart by its `ftyp` brand. */
function sniffBinary(head: Uint8Array, ext: string): DetectedFile | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return image('image/png', 'PNG image', ext);
  if (startsWith(head, [0xff, 0xd8, 0xff])) return image('image/jpeg', 'JPEG image', ext);
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return image('image/gif', 'GIF image', ext);
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return image('image/webp', 'WebP image', ext);
  if (ascii(head, 0, 2) === 'BM' && head.length > 14) return image('image/bmp', 'BMP image', ext);
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) {
    return image('image/tiff', 'TIFF image', ext);
  }
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00]) && ext === 'ico') return image('image/x-icon', 'Icon', ext);
  if (ascii(head, 4, 8) === 'ftyp') {
    const brands = [ascii(head, 8, 12)];
    const boxSize = (head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3];
    for (let offset = 16; offset + 4 <= Math.min(boxSize, head.length); offset += 4) brands.push(ascii(head, offset, offset + 4));
    if (brands.some((brand) => brand === 'avif' || brand === 'avis')) return image('image/avif', 'AVIF image', ext);
    if (brands.some((brand) => ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs'].includes(brand))) {
      return image('image/heic', 'HEIC photo', ext);
    }
    if (brands.some((brand) => brand === 'mif1' || brand === 'msf1')) return image('image/heif', 'HEIF photo', ext);
  }
  const pdfAt = ascii(head, 0, Math.min(head.length, 1024)).indexOf('%PDF-');
  if (pdfAt >= 0) return { kind: 'pdf', mimeType: MIME.pdf, label: 'PDF', ext };
  return null;
}

/** Tells Office Open XML, OpenDocument and EPUB apart by the entries inside the ZIP. */
export function classifyZip(bytes: Uint8Array, ext: string): DetectedFile {
  const names: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter: (file) => {
        names.push(file.name);
        return file.name === 'mimetype' && file.originalSize < 256;
      },
    });
  } catch {
    throw new UnsupportedFileError(DAMAGED_ZIP);
  }
  const has = (name: string) => names.includes(name);
  const office = (mimeType: string, label: string): DetectedFile => ({ kind: 'office', mimeType, label, ext });

  if (has('[Content_Types].xml')) {
    if (has('word/document.xml')) return office(MIME.docx, 'Word document');
    if (has('ppt/presentation.xml') || names.some((name) => name.startsWith('ppt/slides/'))) {
      return office(MIME.pptx, 'PowerPoint presentation');
    }
    if (has('xl/workbook.xml')) return office(MIME.xlsx, 'Excel workbook');
  }
  const declared = entries.mimetype ? strFromU8(entries.mimetype).trim() : '';
  if (declared === MIME.odt) return office(MIME.odt, 'OpenDocument text');
  if (declared === MIME.odp) return office(MIME.odp, 'OpenDocument presentation');
  if (declared === MIME.ods) return office(MIME.ods, 'OpenDocument spreadsheet');
  if (declared === MIME.epub) return office(MIME.epub, 'EPUB book');
  throw new UnsupportedFileError(
    ext === 'zip'
      ? "ZIP archives aren't supported. Unzip it and upload the document inside."
      : UNSUPPORTED,
  );
}

function decodesAsText(head: Uint8Array): boolean {
  if (startsWith(head, [0xff, 0xfe]) || startsWith(head, [0xfe, 0xff])) return true;
  if (head.includes(0)) return false;
  try {
    // The head may cut a multi-byte character in half; `stream` tolerates an incomplete tail.
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

function looksLikeSvg(headText: string): boolean {
  const start = headText.replace(/^﻿/, '').trimStart().toLowerCase();
  if (start.startsWith('<svg')) return true;
  return (start.startsWith('<?xml') || start.startsWith('<!--') || start.startsWith('<!doctype svg')) &&
    start.includes('<svg') && !start.includes('<html');
}

/**
 * Works out what a file really is from its bytes (the browser's `file.type` is often empty or wrong on
 * Windows). Throws UnsupportedFileError with a message for the reader.
 */
export async function detectFile(file: File): Promise<DetectedFile> {
  if (file.size === 0) throw new UnsupportedFileError('This file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UnsupportedFileError(
      `This file is ${formatMegabytes(file.size)}. The limit is ${formatMegabytes(MAX_UPLOAD_BYTES)}. Try a smaller file, or split the document.`,
    );
  }
  const ext = extensionOf(file.name);
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());

  const binary = sniffBinary(head, ext);
  if (binary) return binary;

  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04])) {
    return classifyZip(new Uint8Array(await file.arrayBuffer()), ext);
  }
  if (startsWith(head, [0xd0, 0xcf, 0x11, 0xe0])) {
    // Password-protected .docx/.xlsx/.pptx files are stored in the old container format too.
    throw new UnsupportedFileError(['docx', 'xlsx', 'pptx'].includes(ext) ? PROTECTED_OFFICE : LEGACY_OFFICE);
  }
  if (ascii(head, 0, 5) === '{\\rtf') return { kind: 'office', mimeType: MIME.rtf, label: 'RTF document', ext };

  if (!decodesAsText(head)) throw new UnsupportedFileError(UNSUPPORTED);
  const headText = new TextDecoder().decode(head);
  if (ext === 'svg' || file.type === MIME.svg || looksLikeSvg(headText)) {
    if (headText.toLowerCase().includes('<svg')) return image(MIME.svg, 'SVG image', ext);
  }
  const textType = TEXT_TYPES[ext] ?? TEXT_BY_MIME[file.type.toLowerCase()] ?? TEXT_TYPES.txt;
  return { kind: 'text', mimeType: textType.mimeType, label: textType.label, ext };
}
