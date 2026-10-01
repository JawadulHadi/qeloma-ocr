import { describe, expect, it } from 'vitest';
import { MAX_CHAT_HISTORY, MAX_CHAT_TURN_CHARS } from '../../shared/limits';
import { ApiError } from '../lib/api';
import { ExtractionAbortedError, UnsupportedFileError } from '../lib/extract/types';
import type { Conversation, StoredMessage } from '../lib/store';
import { documentMeta, extractionErrorMessage, isCancellation, titleFromFileName, toChatHistory } from './useConversation';

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
  it('describes the document to the AI without its bytes', () => {
    const conversation = {
      file: { name: 'bill.png', mimeType: 'image/png', typeLabel: 'PNG image', kind: 'image', size: 10, pageCount: 1 },
      extraction: { meanConfidence: 88, engineLabel: 'On-device OCR' },
      source: new Blob(['secret']),
    } as unknown as Conversation;
    expect(documentMeta(conversation)).toEqual({
      fileName: 'bill.png',
      mimeType: 'image/png',
      kind: 'image',
      pageCount: 1,
      meanConfidence: 88,
      engine: 'On-device OCR',
    });
  });
});
