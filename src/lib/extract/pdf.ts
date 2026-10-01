/**
 * PDF reading with pdf.js, loaded on demand so it stays out of the first page load. Character maps, standard
 * fonts and image decoders come from the CDN that matches the installed pdf.js version.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { releaseCanvas } from './image';
import { isTextItem, textItemsToText } from './pdfText';

const PASSWORD_PROTECTED = 'This PDF is password-protected. Remove the password and upload it again.';
const DAMAGED = "This PDF couldn't be opened. It may be damaged.";

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  pdfjsPromise ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(
    ([pdfjs, worker]) => {
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      return pdfjs;
    },
  );
  pdfjsPromise.catch(() => {
    pdfjsPromise = null;
  });
  return pdfjsPromise;
}

export interface PdfDocument {
  pageCount: number;
  /** Text-layer text of a 0-based page. */
  pageText(index: number): Promise<string>;
  /** Renders a 0-based page onto a white canvas whose longest edge is `longEdge` pixels. */
  renderPage(index: number, longEdge: number): Promise<HTMLCanvasElement>;
  close(): Promise<void>;
}

export async function openPdf(file: Blob): Promise<PdfDocument> {
  const pdfjs = await loadPdfJs();
  const assets = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}`;
  const task = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    cMapUrl: `${assets}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}/standard_fonts/`,
    wasmUrl: `${assets}/wasm/`,
    iccUrl: `${assets}/iccs/`,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  });
  let doc: PDFDocumentProxy;
  try {
    doc = await task.promise;
  } catch (err) {
    await task.destroy().catch(() => undefined);
    throw new Error(err instanceof Error && err.name === 'PasswordException' ? PASSWORD_PROTECTED : DAMAGED);
  }

  return {
    pageCount: doc.numPages,
    async pageText(index) {
      const page = await doc.getPage(index + 1);
      try {
        const content = await page.getTextContent();
        return textItemsToText(content.items.filter(isTextItem));
      } finally {
        page.cleanup();
      }
    },
    async renderPage(index, longEdge) {
      const page = await doc.getPage(index + 1);
      try {
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: longEdge / Math.max(base.width, base.height) });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        try {
          // A white background, because OCR expects paper rather than transparency.
          await page.render({ canvas, viewport, background: '#ffffff' }).promise;
        } catch {
          releaseCanvas(canvas);
          throw new Error(`Page ${index + 1} of this PDF couldn't be drawn. It may be damaged.`);
        }
        return canvas;
      } finally {
        page.cleanup();
      }
    },
    async close() {
      await task.destroy().catch(() => undefined);
    },
  };
}
