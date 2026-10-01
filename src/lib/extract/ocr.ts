/**
 * On-device OCR with tesseract.js. One worker serves the whole app: it is created on first use (which
 * downloads the engine and language data once, then the browser caches them) and switches language in place.
 */
import type { Block, LoggerMessage, Worker } from 'tesseract.js';
import { ExtractionAbortedError, type OcrLine } from './types';

export const OCR_LANGUAGES: { code: string; label: string }[] = [
  { code: 'eng', label: 'English' },
  { code: 'urd', label: 'Urdu' },
  { code: 'ara', label: 'Arabic' },
  { code: 'hin', label: 'Hindi' },
  { code: 'fra', label: 'French' },
  { code: 'deu', label: 'German' },
  { code: 'spa', label: 'Spanish' },
  { code: 'por', label: 'Portuguese' },
  { code: 'ita', label: 'Italian' },
  { code: 'tur', label: 'Turkish' },
  { code: 'chi_sim', label: 'Chinese (Simplified)' },
  { code: 'jpn', label: 'Japanese' },
  { code: 'eng+urd', label: 'English + Urdu' },
  { code: 'eng+ara', label: 'English + Arabic' },
];

const ENGINE_FAILED =
  "On-device reading couldn't start. It downloads its reading data the first time, so check your connection and try again.";

export interface OcrPageResult {
  text: string;
  lines: OcrLine[];
  /** 0..100 */
  confidence: number;
}

export interface OcrProgress {
  /** 'loading' while the engine or language data loads; 'recognizing' while it reads. */
  stage: 'loading' | 'recognizing';
  /** 0..1 within the stage. */
  ratio: number;
}

let workerPromise: Promise<Worker> | null = null;
let workerLanguage: string | null = null;
let progressListener: ((progress: OcrProgress) => void) | null = null;

function onLog(message: LoggerMessage): void {
  const stage = message.status === 'recognizing text' ? 'recognizing' : 'loading';
  progressListener?.({ stage, ratio: Math.min(Math.max(message.progress, 0), 1) });
}

async function getWorker(language: string): Promise<Worker> {
  if (!workerPromise) {
    workerLanguage = language;
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker(language, undefined, { logger: onLog }));
    workerPromise.catch(() => {
      workerPromise = null;
      workerLanguage = null;
    });
  }
  const worker = await workerPromise;
  if (workerLanguage !== language) {
    await worker.reinitialize(language);
    workerLanguage = language;
  }
  return worker;
}

/** Terminates the worker; the next recognition starts a new one. */
export async function disposeOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  workerLanguage = null;
  if (!pending) return;
  try {
    await (await pending).terminate();
  } catch {
    // The worker never started or is already gone.
  }
}

function abortedPromise(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    if (signal.aborted) reject(new ExtractionAbortedError());
    signal.addEventListener('abort', () => reject(new ExtractionAbortedError()), { once: true });
  });
}

/**
 * Recognizes one page. Aborting terminates the worker (the only way to stop tesseract mid-page) and
 * rejects with ExtractionAbortedError.
 */
export async function recognize(
  canvas: HTMLCanvasElement,
  language: string,
  opts: { signal?: AbortSignal; onProgress?: (progress: OcrProgress) => void } = {},
): Promise<OcrPageResult> {
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw new ExtractionAbortedError();
  const aborted = abortedPromise(signal);
  const onAbort = () => void disposeOcr();
  signal?.addEventListener('abort', onAbort, { once: true });
  progressListener = onProgress ?? null;
  try {
    const work = (async () => {
      const worker = await getWorker(language).catch(() => {
        throw new Error(ENGINE_FAILED);
      });
      return worker.recognize(canvas, {}, { text: true, blocks: true });
    })();
    // Whichever loses the race must not surface as an unhandled rejection.
    work.catch(() => undefined);
    aborted.catch(() => undefined);
    const { data } = await Promise.race([work, aborted]);
    const lines = blocksToLines(data.blocks);
    return {
      text: linesToText(lines),
      lines,
      confidence: weightedConfidence(lines) ?? clampConfidence(data.confidence),
    };
  } finally {
    progressListener = null;
    signal?.removeEventListener('abort', onAbort);
  }
}

function clampConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 100) : 0;
}

/**
 * Tesseract ≥ 6 returns words only inside blocks → paragraphs → lines. Flattens them to lines of words,
 * with an empty line between paragraphs so the layout survives.
 */
export function blocksToLines(blocks: Pick<Block, 'paragraphs'>[] | null): OcrLine[] {
  const lines: OcrLine[] = [];
  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      if (lines.length > 0 && lines[lines.length - 1].words.length > 0) lines.push({ words: [] });
      for (const line of paragraph.lines) {
        const words = line.words
          .map((word) => ({ text: word.text.trim(), confidence: clampConfidence(word.confidence) }))
          .filter((word) => word.text.length > 0);
        if (words.length > 0) lines.push({ words });
      }
    }
  }
  while (lines.length > 0 && lines[lines.length - 1].words.length === 0) lines.pop();
  return lines;
}

export function linesToText(lines: OcrLine[]): string {
  return lines.map((line) => line.words.map((word) => word.text).join(' ')).join('\n');
}

/** Mean word confidence, weighted by word length so stray one-letter marks count less; null without words. */
export function weightedConfidence(lines: OcrLine[]): number | null {
  let total = 0;
  let weight = 0;
  for (const line of lines) {
    for (const word of line.words) {
      total += word.confidence * word.text.length;
      weight += word.text.length;
    }
  }
  return weight > 0 ? Math.round(total / weight) : null;
}
