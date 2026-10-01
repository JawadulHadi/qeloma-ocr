import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES } from '../../../shared/limits';
import { detectFile, MIME } from './detect';
import { UnsupportedFileError } from './types';

const file = (bytes: BlobPart, name: string, type = '') => new File([bytes], name, { type });
const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(32).fill(0)]);
const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...strToU8(`ftyp${brand}`), 0, 0, 0, 0, ...strToU8('mif1heic'), 0, 0, 0, 0]);

describe('detectFile', () => {
  it.each([
    ['png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'image/png'],
    ['jpg', bytes(0xff, 0xd8, 0xff, 0xe0), 'image/jpeg'],
    ['gif', strToU8('GIF89a................'), 'image/gif'],
    ['webp', strToU8('RIFF\0\0\0\0WEBPVP8 ........'), 'image/webp'],
    ['bmp', strToU8('BM............................'), 'image/bmp'],
    ['tif', bytes(0x49, 0x49, 0x2a, 0x00), 'image/tiff'],
    ['tiff', bytes(0x4d, 0x4d, 0x00, 0x2a), 'image/tiff'],
    ['heic', ftyp('heic'), 'image/heic'],
    ['heif', ftyp('mif1'), 'image/heic'],
    ['avif', ftyp('avif'), 'image/avif'],
  ])('sniffs %s images from their bytes, whatever the browser says', async (ext, data, mimeType) => {
    const detected = await detectFile(file(data, `photo.${ext}`));
    expect(detected).toMatchObject({ kind: 'image', mimeType, ext });
  });

  it('finds a PDF header within the first kilobyte', async () => {
    const detected = await detectFile(file(`junk\n%PDF-1.7\n`, 'scan'));
    expect(detected).toMatchObject({ kind: 'pdf', mimeType: MIME.pdf, label: 'PDF' });
  });

  it.each([
    ['report.docx', { '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>' }, MIME.docx],
    ['deck.pptx', { '[Content_Types].xml': '<Types/>', 'ppt/slides/slide1.xml': '<p/>' }, MIME.pptx],
    ['book.xlsx', { '[Content_Types].xml': '<Types/>', 'xl/workbook.xml': '<w/>' }, MIME.xlsx],
    ['notes.odt', { mimetype: MIME.odt, 'content.xml': '<c/>' }, MIME.odt],
    ['sheet.ods', { mimetype: MIME.ods, 'content.xml': '<c/>' }, MIME.ods],
    ['slides.odp', { mimetype: MIME.odp, 'content.xml': '<c/>' }, MIME.odp],
    ['novel.epub', { mimetype: MIME.epub, 'META-INF/container.xml': '<c/>' }, MIME.epub],
  ])('tells ZIP documents apart: %s', async (name, entries, mimeType) => {
    const zip = zipSync(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, strToU8(value)])));
    expect(await detectFile(file(zip, name))).toMatchObject({ kind: 'office', mimeType });
  });

  it('refuses other ZIP archives with a hint', async () => {
    const zip = zipSync({ 'a.txt': strToU8('hi') });
    await expect(detectFile(file(zip, 'stuff.zip'))).rejects.toThrow(/Unzip it/);
  });

  it('explains that legacy Office files are not supported', async () => {
    const ole = bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    await expect(detectFile(file(ole, 'old.doc'))).rejects.toThrow(/Older \.doc/);
    await expect(detectFile(file(ole, 'locked.docx'))).rejects.toThrow(/password-protected/);
  });

  it('rejects empty and oversized files', async () => {
    await expect(detectFile(file('', 'empty.txt'))).rejects.toBeInstanceOf(UnsupportedFileError);
    const big = { size: MAX_UPLOAD_BYTES + 1, name: 'huge.pdf', type: '' } as File;
    await expect(detectFile(big)).rejects.toThrow(/limit is 25 MB/);
  });

  it('recognizes RTF, SVG and text by content and extension', async () => {
    expect(await detectFile(file('{\\rtf1\\ansi hello}', 'letter.rtf'))).toMatchObject({ kind: 'office', mimeType: MIME.rtf });
    expect(await detectFile(file('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>', 'logo'))).toMatchObject({
      kind: 'image',
      mimeType: MIME.svg,
    });
    expect(await detectFile(file('# Title', 'README.md'))).toMatchObject({ kind: 'text', label: 'Markdown' });
    expect(await detectFile(file('a,b\n1,2', 'data.csv'))).toMatchObject({ kind: 'text', mimeType: 'text/csv' });
    expect(await detectFile(file('plain words', 'noext'))).toMatchObject({ kind: 'text', label: 'Plain text' });
  });

  it('refuses binary data it cannot identify', async () => {
    await expect(detectFile(file(bytes(1, 2, 3, 0, 5), 'blob.bin'))).rejects.toThrow(/can't read this type of file/);
  });
});
