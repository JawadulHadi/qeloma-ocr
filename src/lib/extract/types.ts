import type { FileKind } from '../../../shared/types';

/**
 * How text is pulled out of images and scanned pages.
 *  - 'auto'  : on-device OCR first; ask the AI to re-read only when confidence is low.
 *  - 'local' : on-device OCR only — the file never leaves the browser.
 *  - 'ai'    : AI vision reads images and scanned pages directly.
 * Digital text (PDF text layer, Office files, plain text) is always read directly, whatever the mode.
 */
export type EngineMode = 'auto' | 'local' | 'ai';

/** Where a page's text came from. */
export type PageMethod = 'text-layer' | 'ocr' | 'ai-vision' | 'parsed';

export interface OcrWord {
  text: string;
  /** 0..100 */
  confidence: number;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface ExtractedPage {
  /** 0-based page / slide / sheet index. */
  index: number;
  text: string;
  method: PageMethod;
  /** 0..100 for OCR pages; null when the text is exact (text layer, parsed) or AI-read. */
  confidence: number | null;
  /** Word-level confidence, only for method === 'ocr'. */
  lines?: OcrLine[];
  /** Short note for the reader, e.g. "Re-read by AI (on-device confidence was 54%)". */
  note?: string;
}

export interface DetectedFile {
  kind: FileKind;
  /** Normalized MIME type (sniffed when the browser reports none), e.g. "image/heic". */
  mimeType: string;
  /** Human label, e.g. "PDF", "HEIC image", "Word document". */
  label: string;
  /** Lower-case extension without the dot, or '' when unknown. */
  ext: string;
}

export interface ExtractionResult {
  kind: FileKind;
  mimeType: string;
  /** Human label of the detected type, same as DetectedFile.label. */
  typeLabel: string;
  /** Full text, pages joined with blank lines. */
  text: string;
  pages: ExtractedPage[];
  /** Mean OCR confidence across OCR'd pages (0..100), or null if nothing was OCR'd. */
  meanConfidence: number | null;
  /** Human label of how the text was obtained, e.g. "On-device OCR", "PDF text layer + OCR", "AI vision". */
  engineLabel: string;
  /** Plain-language notes for the reader, e.g. "Pages 41–60 were not read (limit is 40 scanned pages)". */
  warnings: string[];
}

export interface ExtractProgress {
  phase: 'preparing' | 'reading' | 'recognizing' | 'enhancing' | 'done';
  /** 0..1 overall progress. */
  ratio: number;
  /** 1-based page currently being processed, when paged. */
  page?: number;
  pageCount?: number;
  /** Sentence for the UI, e.g. "Reading page 3 of 12". */
  label: string;
}

/**
 * Injected by the app: sends an image to POST /api/vision and returns the transcription.
 * The extraction module never calls fetch itself.
 */
export type VisionFn = (image: Blob, opts: { language: string; signal?: AbortSignal }) => Promise<string>;

export interface ExtractOptions {
  mode: EngineMode;
  /** Tesseract language code(s), e.g. "eng" or "eng+urd". */
  language: string;
  /** Required for 'ai' mode and for Auto escalation; when absent, Auto behaves like 'local'. */
  vision?: VisionFn;
  signal?: AbortSignal;
  onProgress?: (p: ExtractProgress) => void;
}

export interface FilePreview {
  /** Object URL (caller revokes it) of a browser-displayable image of the file / first page. */
  url: string;
  width: number;
  height: number;
}

export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedFileError';
  }
}

export class ExtractionAbortedError extends Error {
  constructor() {
    super('Extraction was cancelled.');
    this.name = 'ExtractionAbortedError';
  }
}
