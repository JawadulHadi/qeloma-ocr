import { describe, expect, it } from 'vitest';
import { MAX_ANALYZE_CHARS, MAX_CHAT_HISTORY, MAX_CHAT_TURN_CHARS } from '../../shared/limits';
import { ApiError } from '../lib/api';
import { ExtractionAbortedError, UnsupportedFileError } from '../lib/extract/types';
import { analysisKey, type Conversation, type StoredMessage, type StoredSource } from '../lib/store';
import {
  composeQuestion,
  documentMeta,
  extractionErrorMessage,
  isAnalysisStale,
  isCancellation,
  titleFromFileName,
  toChatHistory,
  toSourceInputs,
} from './useConversation';

function source(label: string, text: string, extra: Partial<StoredSource> = {}): StoredSource {
  return {
    id: `id-${label}`,
    label,
    included: true,
    origin: 'upload',
    addedAt: 0,
    file: { name: `${label}.png`, mimeType: 'image/png', typeLabel: 'PNG image', kind: 'image', size: 10, pageCount: 1 },
    extraction: {
      kind: 'image',
      mimeType: 'image/png',
      typeLabel: 'PNG image',
      text,
      pages: [],
      meanConfidence: 88,
      engineLabel: 'On-device OCR',
      warnings: [],
    },
    text,
    textEdited: false,
    revision: 0,
    blob: new Blob(['secret']),
    ...extra,
  };
}

const message = (role: StoredMessage['role'], content: string, error?: string): StoredMessage => ({
  id: `${role}-${content}`,
  role,
  content,
  createdAt: 0,
  ...(error ? { error } : {}),
});

describe('titleFromFileName', () => {
  it('drops the extension and falls back for empty names', () => {
    expect(titleFromFileName('Electricity bill.pdf')).toBe('Electricity bill');
    expect(titleFromFileName('scan.2026.10.jpeg')).toBe('scan.2026.10');
    expect(titleFromFileName('.pdf')).toBe('Untitled document');
  });
});

describe('toChatHistory', () => {
  it('keeps answered questions and answers, dropping failed and unanswered questions', () => {
    const history = toChatHistory([
      message('user', 'What is due?'),
      message('assistant', 'Rs 14,230.'),
      message('user', 'Failed one', 'The AI is busy.'),
      message('user', 'Stopped before any answer'),
      message('user', 'When?'),
      message('assistant', 'By 14 October.'),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'What is due?' },
      { role: 'assistant', content: 'Rs 14,230.' },
      { role: 'user', content: 'When?' },
      { role: 'assistant', content: 'By 14 October.' },
    ]);
  });

  it('keeps the newest turns and caps their length', () => {
    const many = Array.from({ length: MAX_CHAT_HISTORY + 4 }, (_, i) => message(i % 2 ? 'assistant' : 'user', `${i}`));
    const history = toChatHistory(many);
    expect(history).toHaveLength(MAX_CHAT_HISTORY);
    expect(history.at(-1)?.content).toBe(`${MAX_CHAT_HISTORY + 3}`);
    const long = toChatHistory([message('user', 'q'), message('assistant', 'x'.repeat(MAX_CHAT_TURN_CHARS + 50))]);
    expect(long[1].content).toHaveLength(MAX_CHAT_TURN_CHARS);
  });
});

describe('errors', () => {
  it('shows our own sentences and hides unexpected technical ones', () => {
    expect(extractionErrorMessage(new UnsupportedFileError('This file is empty.'))).toBe('This file is empty.');
    expect(extractionErrorMessage(new ApiError(413, 'payload_too_large', 'Too large.'))).toBe('Too large.');
    expect(extractionErrorMessage(new Error("This PDF couldn't be opened. It may be damaged."))).toMatch(/PDF/);
    expect(extractionErrorMessage(new TypeError('x is undefined'))).toMatch(/^Couldn't read this file/);
  });

  it('treats cancellations as non-errors', () => {
    expect(isCancellation(new ExtractionAbortedError())).toBe(true);
    expect(isCancellation(new DOMException('stop', 'AbortError'))).toBe(true);
    expect(isCancellation(new Error('boom'))).toBe(false);
  });
});

describe('documentMeta', () => {
  it('describes a source to the AI without its bytes', () => {
    expect(documentMeta(source('S1', 'text'))).toEqual({
      fileName: 'S1.png',
      mimeType: 'image/png',
      kind: 'image',
      pageCount: 1,
      meanConfidence: 88,
      engine: 'On-device OCR',
    });
  });
});

describe('toSourceInputs', () => {
  it('labels each source and shares the length budget', () => {
    const inputs = toSourceInputs([source('S1', 'short'), source('S3', 'x'.repeat(MAX_ANALYZE_CHARS))]);
    expect(inputs.map((input) => input.label)).toEqual(['S1', 'S3']);
    expect(inputs[0].text).toBe('short');
    expect(inputs[0].text.length + inputs[1].text.length).toBeLessThanOrEqual(MAX_ANALYZE_CHARS);
  });
});

describe('composeQuestion', () => {
  it('puts a quoted passage first, labelled with its source', () => {
    expect(composeQuestion('Is this fair?', { sourceId: 'a', label: 'S2', text: 'Rent rises\nby 10%' })).toBe(
      '> Rent rises\n> by 10% [S2]\n\nIs this fair?',
    );
    expect(composeQuestion('Plain question')).toBe('Plain question');
  });

  it('sends quoted questions in the history with their passage', () => {
    const history = toChatHistory([
      { ...message('user', 'Why?'), quote: { sourceId: 'a', label: 'S1', text: 'Late fee' } },
      message('assistant', 'Because.'),
    ]);
    expect(history[0].content).toBe('> Late fee [S1]\n\nWhy?');
  });
});

describe('isAnalysisStale', () => {
  it('notices when the included sources or their text changed', () => {
    const sources = [source('S1', 'a'), source('S2', 'b')];
    const base = { sources, analysis: { title: 't' }, analysisKey: analysisKey({ sources }) } as unknown as Conversation;
    expect(isAnalysisStale(base)).toBe(false);
    expect(isAnalysisStale({ ...base, sources: [sources[0], { ...sources[1], included: false }] })).toBe(true);
    expect(isAnalysisStale({ ...base, sources: [sources[0], { ...sources[1], revision: 1 }] })).toBe(true);
  });
});
