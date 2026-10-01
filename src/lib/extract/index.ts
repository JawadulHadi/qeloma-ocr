/**
 * Scanwise's in-browser extraction engine: detect → read every page → one ExtractionResult.
 * Heavy engines (pdf.js, tesseract.js, HEIC and TIFF decoders) load only when a file needs them.
 */
import { MAX_OCR_PDF_PAGES, MAX_PDF_PAGES } from '../../../shared/limits';
import { buildResult, readPages, throwIfAborted, type PageContent, type PageEngine } from './assemble';
import { detectFile } from './detect';
import { canvasToPreview, decodeImagePages, prepareForOcr, releaseCanvas, toVisionBlob } from './image';
import { disposeOcr, recognize } from './ocr';
import { officeToPages } from './office';
import { openPdf } from './pdf';
import { rtfToText } from './rtf';
import { decodeText, textFileToText, visibleLength } from './text';
import type { DetectedFile, ExtractionResult, ExtractOptions, FilePreview } from './types';

export * from './types';
export { AI_VISION_MISSING } from './assemble';
export { ACCEPT_ATTR, SUPPORTED_GROUPS, detectFile } from './detect';
export { OCR_LANGUAGES } from './ocr';

/** Longest edge of a scanned PDF page rendered for OCR or AI vision. */
const PDF_RENDER_EDGE = 2000;
const PREVIEW_EDGE = 1600;
/** A PDF page with fewer visible characters than this in its text layer is treated as scanned. */
const SCANNED_PAGE_CHARS = 16;

const canvasEngine: PageEngine<HTMLCanvasElement> = {
  async ocr(canvas, language, opts) {
    const prepared = prepareForOcr(canvas);
    try {
      return await recognize(prepared, language, opts);
    } finally {
      if (prepared !== canvas) releaseCanvas(prepared);
    }
  },
  toVisionBlob,
  release: releaseCanvas,
};

/** A browser-displayable picture of the file (first page for PDFs and multi-page TIFFs), or null. */
export async function makePreview(file: File, detected: DetectedFile): Promise<FilePreview | null> {
  try {
    if (detected.kind === 'image') {
      const [first, ...rest] = await decodeImagePages(file, detected);
      rest.forEach(releaseCanvas);
      try {
        return await canvasToPreview(first);
      } finally {
        releaseCanvas(first);
      }
    }
    if (detected.kind === 'pdf') {
      const pdf = await openPdf(file);
      try {
        const canvas = await pdf.renderPage(0, PREVIEW_EDGE);
        try {
          return await canvasToPreview(canvas);
        } finally {
          releaseCanvas(canvas);
        }
      } finally {
        await pdf.close();
      }
    }
  } catch {
    // A missing preview is not an error: extraction reports anything that is really wrong with the file.
  }
  return null;
}

function officeNoun(mimeType: string): string {
  if (/presentation/.test(mimeType)) return 'slide';
  if (/sheet/.test(mimeType)) return 'sheet';
  if (/epub/.test(mimeType)) return 'chapter';
  return 'page';
}

async function extractImage(file: File, detected: DetectedFile, opts: ExtractOptions): Promise<ExtractionResult> {
  const canvases = await decodeImagePages(file, detected);
  try {
    const read = await readPages(
      canvases.length,
      async (index): Promise<PageContent<HTMLCanvasElement>> => ({ type: 'image', render: async () => canvases[index] }),
      canvasEngine,
      { ...opts, noun: canvases.length > 1 ? 'page' : 'image' },
    );
    return buildResult(detected, read);
  } finally {
    canvases.forEach(releaseCanvas);
  }
}

async function extractPdf(file: File, detected: DetectedFile, opts: ExtractOptions): Promise<ExtractionResult> {
  const pdf = await openPdf(file);
  try {
    throwIfAborted(opts.signal);
    const count = Math.min(pdf.pageCount, MAX_PDF_PAGES);
    const warnings =
      pdf.pageCount > MAX_PDF_PAGES
        ? [`Only the first ${MAX_PDF_PAGES} pages were read. This PDF has ${pdf.pageCount}.`]
        : [];
    const read = await readPages(
      count,
      async (index): Promise<PageContent<HTMLCanvasElement>> => {
        const text = await pdf.pageText(index);
        if (visibleLength(text) >= SCANNED_PAGE_CHARS) return { type: 'text', text, method: 'text-layer' };
        return { type: 'image', render: () => pdf.renderPage(index, PDF_RENDER_EDGE) };
      },
      canvasEngine,
      { ...opts, noun: 'page', maxImagePages: MAX_OCR_PDF_PAGES },
    );
    return buildResult(detected, read, warnings);
  } finally {
    await pdf.close();
  }
}

async function extractDirect(file: File, detected: DetectedFile, opts: ExtractOptions): Promise<ExtractionResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  throwIfAborted(opts.signal);
  let texts: string[];
  let warnings: string[] = [];
  let noun = 'page';
  if (detected.kind === 'text') {
    texts = [textFileToText(decodeText(bytes), detected.mimeType)];
  } else if (detected.mimeType === 'application/rtf') {
    texts = [rtfToText(decodeText(bytes))];
  } else {
    const office = officeToPages(bytes, detected.mimeType);
    texts = office.pages.map((page) => page.text);
    warnings = office.warnings;
    noun = officeNoun(detected.mimeType);
  }
  const read = await readPages<never>(
    texts.length,
    async (index) => ({ type: 'text', text: texts[index], method: 'parsed' }),
    {
      ocr: () => Promise.reject(new Error('Not an image.')),
      toVisionBlob: () => Promise.reject(new Error('Not an image.')),
      release: () => undefined,
    },
    { ...opts, noun },
  );
  return buildResult(detected, read, warnings);
}

/**
 * Extracts the text of any supported file. Throws UnsupportedFileError, ExtractionAbortedError, or an Error
 * whose message is written for the reader.
 */
export async function extractText(file: File, opts: ExtractOptions): Promise<ExtractionResult> {
  throwIfAborted(opts.signal);
  opts.onProgress?.({ phase: 'preparing', ratio: 0, label: 'Getting the file ready…' });
  const detected = await detectFile(file);
  throwIfAborted(opts.signal);

  let result: ExtractionResult;
  switch (detected.kind) {
    case 'image':
      result = await extractImage(file, detected, opts);
      break;
    case 'pdf':
      result = await extractPdf(file, detected, opts);
      break;
    default:
      result = await extractDirect(file, detected, opts);
  }
  opts.onProgress?.({ phase: 'done', ratio: 1, label: 'Done' });
  return result;
}

/** Stops the on-device OCR worker and frees its memory. */
export async function disposeExtractors(): Promise<void> {
  await disposeOcr();
}
