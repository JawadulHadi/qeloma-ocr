import { describe, expect, it, vi } from 'vitest';
import {
  AI_VISION_MISSING,
  NO_TEXT_FOUND,
  REREAD_FAILED,
  buildResult,
  engineLabel,
  formatRanges,
  readPages,
  type PageContent,
  type PageEngine,
} from './assemble';
import type { OcrPageResult } from './ocr';
import { ExtractionAbortedError, type DetectedFile, type ExtractProgress, type VisionFn } from './types';

/** A fake "image" is just the OCR result it should produce. */
type FakeImage = OcrPageResult;

const ocrPage = (text: string, confidence: number): FakeImage => ({
  text,
  confidence,
  lines: [{ words: text.split(' ').map((word) => ({ text: word, confidence })) }],
});

const engine: PageEngine<FakeImage> = {
  ocr: async (image, _language, { onProgress }) => {
    onProgress({ stage: 'recognizing', ratio: 0.5 });
    return image;
  },
  toVisionBlob: async (image) => new Blob([image.text]),
  release: () => undefined,
};

const images = (...pages: FakeImage[]) => (index: number): Promise<PageContent<FakeImage>> =>
  Promise.resolve({ type: 'image', render: async () => pages[index] });

const IMAGE: DetectedFile = { kind: 'image', mimeType: 'image/png', label: 'PNG image', ext: 'png' };
const PDF: DetectedFile = { kind: 'pdf', mimeType: 'application/pdf', label: 'PDF', ext: 'pdf' };

describe('readPages', () => {
  it('keeps on-device text in local mode and reports monotonic progress', async () => {
    const progress: ExtractProgress[] = [];
    const vision = vi.fn<VisionFn>();
    const read = await readPages(2, images(ocrPage('Amount due', 92), ocrPage('Due date', 40)), engine, {
      mode: 'local',
      language: 'eng',
      vision,
      noun: 'page',
      onProgress: (p) => progress.push(p),
    });
    expect(vision).not.toHaveBeenCalled();
    expect(read.pages.map((page) => [page.method, page.confidence])).toEqual([
      ['ocr', 92],
      ['ocr', 40],
    ]);
    expect(progress.map((p) => p.label)).toContain('Recognizing text on page 2 of 2');
    const ratios = progress.map((p) => p.ratio);
    expect([...ratios].sort((a, b) => a - b)).toEqual(ratios);

    const result = buildResult(IMAGE, read);
    expect(result.meanConfidence).toBe(66);
    expect(result.engineLabel).toBe('On-device OCR');
    expect(result.text).toBe('Amount due\n\nDue date');
  });

  it('has the AI re-read only low-confidence pages in Auto mode', async () => {
    const vision = vi.fn<VisionFn>().mockResolvedValue('Due date 14 October');
    const read = await readPages(2, images(ocrPage('Amount due', 92), ocrPage('Dve dat3', 54)), engine, {
      mode: 'auto',
      language: 'eng',
      vision,
      noun: 'page',
    });
    expect(vision).toHaveBeenCalledTimes(1);
    expect(read.pages[1]).toMatchObject({
      method: 'ai-vision',
      confidence: null,
      text: 'Due date 14 October',
      note: 'Re-read by AI (on-device confidence was 54%)',
    });
    const result = buildResult(IMAGE, read);
    expect(result.engineLabel).toBe('On-device OCR + AI re-read');
    expect(result.meanConfidence).toBe(92);
  });

  it('keeps the on-device text when the AI re-read fails', async () => {
    const vision = vi.fn<VisionFn>().mockRejectedValue(new Error('AI down'));
    const read = await readPages(1, images(ocrPage('blurry', 30)), engine, { mode: 'auto', language: 'eng', vision, noun: 'image' });
    expect(read.pages[0]).toMatchObject({ method: 'ocr', text: 'blurry' });
    expect(read.warnings).toEqual([REREAD_FAILED]);
  });

  it('reads images with AI vision in AI mode, and needs a vision function for it', async () => {
    const vision = vi.fn<VisionFn>().mockResolvedValue('Handwritten note');
    const read = await readPages(1, images(ocrPage('x', 10)), engine, { mode: 'ai', language: 'eng', vision, noun: 'image' });
    expect(read.pages[0]).toMatchObject({ method: 'ai-vision', text: 'Handwritten note' });
    expect(buildResult(IMAGE, read).engineLabel).toBe('AI vision');

    await expect(readPages(1, images(ocrPage('x', 10)), engine, { mode: 'ai', language: 'eng', noun: 'image' })).rejects.toThrow(
      AI_VISION_MISSING,
    );
  });

  it('never sends digital text to vision, and caps scanned pages with a warning', async () => {
    const vision = vi.fn<VisionFn>().mockResolvedValue('AI text');
    const load = (index: number): Promise<PageContent<FakeImage>> =>
      Promise.resolve(
        index === 0
          ? { type: 'text', text: 'INVOICE 2026', method: 'text-layer' }
          : { type: 'image', render: async () => ocrPage(`scan ${index}`, 95) },
      );
    const read = await readPages(5, load, engine, { mode: 'ai', language: 'eng', vision, noun: 'page', maxImagePages: 2 });
    expect(vision).toHaveBeenCalledTimes(2);
    expect(read.pages.map((page) => page.method)).toEqual(['text-layer', 'ai-vision', 'ai-vision']);
    expect(read.warnings).toEqual(["Pages 4–5 weren't read: Scanwise reads up to 2 scanned pages per document."]);
    expect(buildResult(PDF, read).engineLabel).toBe('PDF text layer + AI vision');
  });

  it('stops with ExtractionAbortedError when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      readPages(1, images(ocrPage('x', 90)), engine, { mode: 'local', language: 'eng', noun: 'image', signal: controller.signal }),
    ).rejects.toBeInstanceOf(ExtractionAbortedError);
  });
});

describe('buildResult', () => {
  it('warns when an image has no text, but not for empty office files', async () => {
    const empty = await readPages(1, images({ text: '', confidence: 0, lines: [] }), engine, { mode: 'local', language: 'eng', noun: 'image' });
    expect(buildResult(IMAGE, empty).warnings).toEqual([NO_TEXT_FOUND]);
    const office: DetectedFile = { kind: 'office', mimeType: 'x', label: 'Word document', ext: 'docx' };
    expect(buildResult(office, { pages: [], warnings: [], escalated: 0 }).warnings).toEqual([]);
  });

  it('labels engines by what was actually used', () => {
    expect(engineLabel('office', [], 0)).toBe('Parsed directly');
    expect(engineLabel('text', [], 0)).toBe('Read directly');
    expect(engineLabel('pdf', [{ index: 0, text: 'a', method: 'text-layer', confidence: null }], 0)).toBe('PDF text layer');
    expect(
      engineLabel(
        'pdf',
        [
          { index: 0, text: 'a', method: 'text-layer', confidence: null },
          { index: 1, text: 'b', method: 'ocr', confidence: 90 },
        ],
        0,
      ),
    ).toBe('PDF text layer + on-device OCR');
  });

  it('formats page ranges', () => {
    expect(formatRanges([3])).toBe('3');
    expect(formatRanges([3, 4, 5, 9, 11, 12])).toBe('3–5, 9, 11–12');
  });
});
