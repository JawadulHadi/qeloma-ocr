import { describe, expect, it } from 'vitest';
import {
  GUEST_ID,
  adoptGuestConversations,
  analysisKey,
  listConversations,
  readConversation,
  saveConversation,
  type Conversation,
} from './store';

const EXTRACTION = {
  kind: 'text',
  mimeType: 'text/plain',
  typeLabel: 'Text',
  text: 'hello',
  pages: [],
  meanConfidence: null,
  engineLabel: 'Read directly',
  warnings: [],
} as const;

function conversation(id: string, userId: string, updatedAt: number): Conversation {
  return {
    version: 2,
    id,
    userId,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    sources: [],
    nextSourceNumber: 1,
    analysis: null,
    analysisKey: null,
    model: null,
    analysisTruncated: false,
    messages: [],
  };
}

describe('readConversation', () => {
  it('turns a conversation saved before sources into one with source S1', () => {
    const saved = {
      id: 'old',
      userId: 'u',
      title: 'Bill',
      createdAt: 1,
      updatedAt: 2,
      file: { name: 'bill.txt', mimeType: 'text/plain', typeLabel: 'Text', kind: 'text', size: 5, pageCount: 1 },
      extraction: EXTRACTION,
      text: 'hello edited',
      textEdited: true,
      analysis: { title: 'Bill', summary: 'A bill.' },
      model: 'm',
      analysisTruncated: false,
      messages: [],
      source: null,
    };
    const c = readConversation(saved);
    expect(c?.version).toBe(2);
    expect(c?.sources).toHaveLength(1);
    expect(c?.sources[0]).toMatchObject({ label: 'S1', included: true, text: 'hello edited', textEdited: true });
    expect(c?.nextSourceNumber).toBe(2);
    // The old summary was made from that one document, so it isn't out of date.
    expect(c && c.analysisKey === analysisKey(c)).toBe(true);
  });

  it('rejects records that are not conversations', () => {
    expect(readConversation(null)).toBeNull();
    expect(readConversation({ id: 'x' })).toBeNull();
  });
});

describe('adoptGuestConversations', () => {
  it('moves documents read before sign-in into the account and returns the newest', async () => {
    await saveConversation(conversation('older', GUEST_ID, 1));
    await saveConversation(conversation('newer', GUEST_ID, 2));

    expect(await adoptGuestConversations('account-1')).toBe('newer');
    expect((await listConversations('account-1')).map((c) => c.id)).toEqual(['newer', 'older']);
    expect(await listConversations(GUEST_ID)).toEqual([]);
  });

  it('returns null when nothing was read before sign-in', async () => {
    expect(await adoptGuestConversations('account-2')).toBeNull();
    expect(await listConversations('account-2')).toEqual([]);
  });
});
