/**
 * Turns what someone picked or dropped into the files to read: ZIP archives are unpacked here, in the browser,
 * so each document inside becomes its own source. Office files are ZIPs too, but only a ".zip" is unpacked.
 */
import { unzip, type UnzipFileInfo } from 'fflate';
import { MAX_UPLOAD_BYTES, MAX_ZIP_ENTRIES, MAX_ZIP_UNPACKED_BYTES } from '../../shared/limits';
import { formatMegabytes } from './extract/detect';

/** A file that won't be read, and why (a sentence for the reader). */
export interface SkippedFile {
  name: string;
  reason: string;
}

export interface Bundle {
  files: File[];
  skipped: SkippedFile[];
}

const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'application/x-zip']);
const JUNK = /(^|\/)(__MACOSX\/|\.[^/]*$|Thumbs\.db$|desktop\.ini$)/i;

export function isZipArchive(file: File): boolean {
  return /\.zip$/i.test(file.name) || (ZIP_TYPES.has(file.type) && !/\.[a-z0-9]+$/i.test(file.name));
}

function baseName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function unzipAsync(data: Uint8Array, filter: (file: UnzipFileInfo) => boolean): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, { filter }, (err, entries) => (err ? reject(err) : resolve(entries)));
  });
}

async function unpack(archive: File): Promise<Bundle> {
  const skipped: SkippedFile[] = [];
  const order: string[] = [];
  let unpacked = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = await unzipAsync(new Uint8Array(await archive.arrayBuffer()), (entry) => {
      if (entry.name.endsWith('/') || JUNK.test(entry.name) || entry.originalSize === 0) return false;
      const name = baseName(entry.name);
      if (/\.zip$/i.test(name)) {
        skipped.push({ name, reason: 'ZIP files inside a ZIP aren’t opened. Unzip it and add the files inside.' });
        return false;
      }
      if (entry.originalSize > MAX_UPLOAD_BYTES) {
        skipped.push({ name, reason: `It is over the ${formatMegabytes(MAX_UPLOAD_BYTES)} limit for one file.` });
        return false;
      }
      if (order.length >= MAX_ZIP_ENTRIES || unpacked + entry.originalSize > MAX_ZIP_UNPACKED_BYTES) {
        skipped.push({ name, reason: `Only the first ${MAX_ZIP_ENTRIES} files of an archive are read.` });
        return false;
      }
      order.push(entry.name);
      unpacked += entry.originalSize;
      return true;
    });
  } catch {
    return { files: [], skipped: [{ name: archive.name, reason: 'This ZIP file couldn’t be opened. It may be damaged.' }] };
  }
  const files = order
    .filter((path) => entries[path])
    .map((path) => new File([entries[path] as Uint8Array<ArrayBuffer>], baseName(path), { lastModified: archive.lastModified }));
  if (files.length === 0 && skipped.length === 0) {
    skipped.push({ name: archive.name, reason: 'This ZIP file has no documents in it.' });
  }
  return { files, skipped };
}

/** Unpacks every ZIP among `picked`; other files pass through unchanged, in the order they were picked. */
export async function expandBundles(picked: readonly File[]): Promise<Bundle> {
  const files: File[] = [];
  const skipped: SkippedFile[] = [];
  for (const file of picked) {
    if (!isZipArchive(file)) {
      files.push(file);
      continue;
    }
    const bundle = await unpack(file);
    files.push(...bundle.files);
    skipped.push(...bundle.skipped);
  }
  return { files, skipped };
}
