/**
 * The page pipeline every document goes through: digital text is taken as is, images and scanned pages go
 * to on-device OCR or AI vision depending on the Reading mode. The image type is generic and the engines are
 * injected, so this runs in tests without canvas, tesseract or a server.
 */
import { AUTO_ESCALATE_BELOW } from '../../../shared/limits';
import type { FileKind } from '../../../shared/types';
import type { OcrPageResult, OcrProgress } from './ocr';
import { normalizeText } from './text';
import {
  ExtractionAbortedError,
  type DetectedFile,
  type ExtractedPage,
  type ExtractionResult,
  type ExtractOptions,
  type ExtractProgress,
} from './types';

export const AI_VISION_MISSING = "AI vision isn't available. Switch Reading to On-device and try again.";
export const REREAD_FAILED = 'The AI re-read failed, so this shows the on-device text.';
export const VISION_FAILED = "AI vision couldn't read this, so it was read on your device instead.";
export const NO_TEXT_FOUND = 'No text was found. For photos, try better light or set Reading to AI vision.';

export interface TextPage {
  type: 'text';
  text: string;
  method: 'text-layer' | 'parsed';
}

export interface ImagePage<T> {
  type: 'image';
  render(): Promise<T>;
}

export type PageContent<T> = TextPage | ImagePage<T>;

export interface PageEngine<T> {
  ocr(image: T, language: string, opts: { signal?: AbortSignal; onProgress(progress: OcrProgress): void }): Promise<OcrPageResult>;
  toVisionBlob(image: T): Promise<Blob>;
  release(image: T): void;
}

export interface ReadOptions extends ExtractOptions {
  /** What one page is called in progress labels and warnings: "page", "slide", "sheet", "image"… */
  noun: string;
  /** Most image pages read; later ones are skipped with a warning. */
  maxImagePages?: number;
}

export interface ReadResult {
  pages: ExtractedPage[];
  warnings: string[];
  /** Pages that Auto mode had the AI re-read. */
  escalated: number;
}

export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return err instanceof ExtractionAbortedError || (err instanceof Error && err.name === 'AbortError') || signal?.aborted === true;
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ExtractionAbortedError();
}

/** "3", "3–5", "3–5, 9" from sorted 1-based numbers. */
export function formatRanges(numbers: number[]): string {
  const ranges: string[] = [];
  let start = numbers[0];
  let end = start;
  for (const n of [...numbers.slice(1), Number.NaN]) {
    if (n === end + 1) {
      end = n;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}–${end}`);
    start = n;
    end = n;
  }
  return ranges.join(', ');
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export async function readPages<T>(
  count: number,
  load: (index: number) => Promise<PageContent<T>>,
  engine: PageEngine<T>,
  opts: ReadOptions,
): Promise<ReadResult> {
  const { mode, language, vision, signal, onProgress, noun, maxImagePages } = opts;
  const pages: ExtractedPage[] = [];
  const warnings = new Set<string>();
  const skipped: number[] = [];
  let imagePages = 0;
  let escalated = 0;
  let lastRatio = 0;

  const report = (phase: ExtractProgress['phase'], index: number, within: number, label: string) => {
    lastRatio = Math.max(lastRatio, Math.min(1, (index + within) / count));
    onProgress?.({ phase, ratio: lastRatio, page: index + 1, pageCount: count, label });
  };
  const where = (index: number) => (count > 1 ? `${noun} ${index + 1} of ${count}` : `the ${noun}`);

  const readWithVision = async (image: T): Promise<string> => {
    if (!vision) throw new Error(AI_VISION_MISSING);
    const blob = await engine.toVisionBlob(image);
    throwIfAborted(signal);
    return normalizeText(await vision(blob, { language, signal }));
  };

  const ocr = (image: T, index: number) =>
    engine.ocr(image, language, {
      signal,
      onProgress: ({ stage, ratio }) =>
        stage === 'loading'
          ? report('preparing', index, 0, 'Getting the on-device reader ready…')
          : report('recognizing', index, ratio, count > 1 ? `Recognizing text on ${where(index)}` : 'Recognizing text…'),
    });

  for (let index = 0; index < count; index += 1) {
    throwIfAborted(signal);
    report('reading', index, 0, count > 1 ? `Reading ${where(index)}` : 'Reading the file…');
    const content = await load(index);
    throwIfAborted(signal);

    if (content.type === 'text') {
      pages.push({ index, text: normalizeText(content.text), method: content.method, confidence: null });
      continue;
    }
    if (maxImagePages !== undefined && imagePages >= maxImagePages) {
      skipped.push(index + 1);
      continue;
    }
    imagePages += 1;
    if (mode === 'ai' && !vision) throw new Error(AI_VISION_MISSING);

    const image = await content.render();
    try {
      throwIfAborted(signal);
      if (mode === 'ai') {
        report('recognizing', index, 0.1, `Reading ${where(index)} with AI…`);
        try {
          pages.push({ index, text: await readWithVision(image), method: 'ai-vision', confidence: null });
          continue;
        } catch (err) {
          if (isAbort(err, signal)) throw new ExtractionAbortedError();
          warnings.add(VISION_FAILED);
        }
      }

      const result = await ocr(image, index);
      throwIfAborted(signal);
      let page: ExtractedPage = { index, text: result.text, method: 'ocr', confidence: result.confidence, lines: result.lines };
      if (mode === 'auto' && vision && result.confidence < AUTO_ESCALATE_BELOW) {
        report('enhancing', index, 0.9, `Asking the AI to re-read ${where(index)}…`);
        try {
          const text = await readWithVision(image);
          if (text) {
            page = { index, text, method: 'ai-vision', confidence: null, note: `Re-read by AI (on-device confidence was ${result.confidence}%)` };
            escalated += 1;
          }
        } catch (err) {
          if (isAbort(err, signal)) throw new ExtractionAbortedError();
          warnings.add(REREAD_FAILED);
        }
      }
      pages.push(page);
    } catch (err) {
      throw isAbort(err, signal) ? new ExtractionAbortedError() : err;
    } finally {
      engine.release(image);
    }
  }

  if (skipped.length > 0) {
    const label = skipped.length === 1 ? capitalize(noun) : `${capitalize(noun)}s`;
    warnings.add(
      `${label} ${formatRanges(skipped)} ${skipped.length === 1 ? "wasn't" : "weren't"} read: Scanwise reads up to ${maxImagePages} scanned ${noun}s per document.`,
    );
  }
  return { pages, warnings: [...warnings], escalated };
}

/** Mean confidence of the pages still read by OCR, weighted by how many words each has. */
export function meanOcrConfidence(pages: ExtractedPage[]): number | null {
  let total = 0;
  let words = 0;
  for (const page of pages) {
    if (page.method !== 'ocr' || page.confidence === null) continue;
    const count = page.lines?.reduce((sum, line) => sum + line.words.length, 0) ?? 0;
    total += page.confidence * count;
    words += count;
  }
  return words > 0 ? Math.round(total / words) : null;
}

export function engineLabel(kind: FileKind, pages: ExtractedPage[], escalated: number): string {
  if (kind === 'office') return 'Parsed directly';
  if (kind === 'text') return 'Read directly';
  const has = (method: ExtractedPage['method']) => pages.some((page) => page.method === method);
  const parts: string[] = [];
  if (has('text-layer')) parts.push('PDF text layer');
  if (has('ocr') || escalated > 0) parts.push('on-device OCR');
  if (escalated > 0) parts.push('AI re-read');
  else if (has('ai-vision')) parts.push('AI vision');
  if (parts.length === 0) return kind === 'pdf' ? 'PDF text layer' : 'On-device OCR';
  return capitalize(parts.join(' + '));
}

export function buildResult(detected: DetectedFile, read: ReadResult, extraWarnings: string[] = []): ExtractionResult {
  const text = read.pages
    .map((page) => page.text)
    .filter((pageText) => pageText.length > 0)
    .join('\n\n');
  const warnings = [...extraWarnings, ...read.warnings];
  if (!text && (detected.kind === 'image' || detected.kind === 'pdf')) warnings.push(NO_TEXT_FOUND);
  return {
    kind: detected.kind,
    mimeType: detected.mimeType,
    typeLabel: detected.label,
    text,
    pages: read.pages,
    meanConfidence: meanOcrConfidence(read.pages),
    engineLabel: engineLabel(detected.kind, read.pages, read.escalated),
    warnings,
  };
}
