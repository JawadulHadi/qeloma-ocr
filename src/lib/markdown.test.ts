import { describe, expect, it } from 'vitest';
import { conversationToMarkdown } from './markdown';
import type { Conversation, StoredSource } from './store';

function source(label: string, name: string, included = true): StoredSource {
  return {
    id: label,
    label,
    included,
    origin: 'upload',
    addedAt: 0,
    file: { name, mimeType: 'text/plain', typeLabel: 'Plain text', kind: 'text', size: 2048, pageCount: 1 },
    extraction: {
      kind: 'text',
      mimeType: 'text/plain',
      typeLabel: 'Plain text',
      text: `Text of ${name}`,
      pages: [],
      meanConfidence: null,
      engineLabel: 'Read directly',
      warnings: [],
    },
    text: `Text of ${name}`,
    textEdited: false,
    revision: 0,
    blob: null,
  };
}

const conversation: Conversation = {
  version: 2,
  id: 'c1',
  userId: 'u',
  title: 'Tenancy paperwork',
  createdAt: Date.UTC(2026, 9, 1, 9),
  updatedAt: Date.UTC(2026, 9, 1, 9),
  sources: [source('S1', 'lease.txt'), source('S2', 'letter.txt', false)],
  nextSourceNumber: 3,
  analysis: {
    title: 'Tenancy paperwork',
    documentType: 'Lease',
    language: 'English',
    summary: 'Rent rises in December [S1].',
    keyFactors: [],
    keyPoints: [],
    solutions: [],
    openQuestions: [],
    caveats: [],
  },
  analysisKey: 'S1@0',
  model: 'gemini',
  analysisTruncated: false,
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: 'Is this fair?',
      createdAt: Date.UTC(2026, 9, 1, 9, 5),
      quote: { sourceId: 'S1', label: 'S1', text: 'Rent rises to Rs 85,000' },
    },
  ],
};

describe('conversationToMarkdown', () => {
  const markdown = conversationToMarkdown(conversation, { exportedAt: new Date(Date.UTC(2026, 9, 1, 10)) });

  it('lists the sources the citation markers refer to', () => {
    expect(markdown).toContain('## Sources');
    expect(markdown).toMatch(/\| S1 \| lease\.txt \| Plain text \| 2 KB \| 1 \| Read directly \| Yes \|/);
    expect(markdown).toMatch(/\| S2 \| letter\.txt \|.*\| No \|/);
  });

  it('keeps the markers in the summary and the quoted passage in the chat', () => {
    expect(markdown).toContain('Rent rises in December [S1].');
    expect(markdown).toContain('> Rent rises to Rs 85,000\n>\n> — [S1]');
  });

  it('includes each source’s text under its label', () => {
    expect(markdown).toContain('### S1 — lease.txt');
    expect(markdown).toContain('### S2 — letter.txt');
  });
});
