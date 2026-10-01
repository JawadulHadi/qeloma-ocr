import { describe, expect, it } from 'vitest';
import { MAX_ANALYZE_CHARS, MAX_SOURCES } from '../shared/limits.js';
import { HttpError } from './http.js';
import { validateAnalyzeRequest, validateChatRequest, validateSources, validateTranscribeRequest } from './validate.js';

const DOCUMENT = { fileName: 'bill.pdf', mimeType: 'application/pdf', kind: 'pdf', pageCount: 1, meanConfidence: null, engine: 'PDF text layer' };

function source(label: string, text: string) {
  return { label, text, document: DOCUMENT };
}

function rejects(run: () => unknown, status = 400): void {
  try {
    run();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(status);
    return;
  }
  throw new Error('expected a rejection');
}

describe('validateSources', () => {
  it('keeps labels and drops sources without text', () => {
    const sources = validateSources([source('S1', ' Rent is due. '), source('S2', '   '), source('S4', 'Deposit')], 'empty');
    expect(sources.map((s) => [s.label, s.text, s.truncated])).toEqual([
      ['S1', 'Rent is due.', false],
      ['S4', 'Deposit', false],
    ]);
  });

  it('shares the length budget across sources', () => {
    const long = 'x'.repeat(MAX_ANALYZE_CHARS);
    const sources = validateSources([source('S1', 'short'), source('S2', long), source('S3', long)], 'empty');
    expect(sources[0]).toMatchObject({ text: 'short', truncated: false });
    expect(sources[1].truncated && sources[2].truncated).toBe(true);
    expect(sources.reduce((sum, s) => sum + s.text.length, 0)).toBeLessThanOrEqual(MAX_ANALYZE_CHARS);
  });

  it('rejects bad labels, duplicates, too many sources and no text', () => {
    rejects(() => validateSources([source('X1', 'a')], 'empty'));
    rejects(() => validateSources([source('S0', 'a')], 'empty'));
    rejects(() => validateSources([source('S1', 'a'), source('S1', 'b')], 'empty'));
    rejects(() => validateSources(Array.from({ length: MAX_SOURCES + 1 }, (_, i) => source(`S${i + 1}`, 'a')), 'empty'));
    rejects(() => validateSources([source('S1', ' ')], 'empty'));
    rejects(() => validateSources([], 'empty'));
  });
});

describe('requests', () => {
  it('accepts an analysis of several sources', () => {
    const { sources } = validateAnalyzeRequest({ sources: [source('S1', 'a'), source('S2', 'b')] });
    expect(sources).toHaveLength(2);
  });

  it('accepts a chat question over sources', () => {
    const chat = validateChatRequest({ sources: [source('S1', 'a')], analysis: null, history: [], question: ' Why? ' });
    expect(chat.question).toBe('Why?');
    expect(chat.sources[0].label).toBe('S1');
  });
});

describe('validateTranscribeRequest', () => {
  it('accepts browser recording formats and drops codec parameters', () => {
    expect(validateTranscribeRequest({ audio: 'AAAA', mimeType: 'audio/webm;codecs=opus' })).toEqual({
      audio: 'AAAA',
      mimeType: 'audio/webm',
    });
  });

  it('rejects other types and bad data', () => {
    rejects(() => validateTranscribeRequest({ audio: 'AAAA', mimeType: 'video/mp4' }));
    rejects(() => validateTranscribeRequest({ audio: 'not base64!', mimeType: 'audio/ogg' }));
  });
});
