import { describe, expect, it } from 'vitest';
import { GUEST_ID, adoptGuestConversations, listConversations, saveConversation, type Conversation } from './store';

function conversation(id: string, userId: string, updatedAt: number): Conversation {
  return {
    id,
    userId,
    title: id,
    createdAt: updatedAt,
    updatedAt,
    file: { name: `${id}.txt`, mimeType: 'text/plain', typeLabel: 'Text', kind: 'text', size: 10, pageCount: 1 },
    extraction: {
      kind: 'text',
      mimeType: 'text/plain',
      typeLabel: 'Text',
      text: 'hello',
      pages: [],
      meanConfidence: null,
      engineLabel: 'Read directly',
      warnings: [],
    },
    text: 'hello',
    textEdited: false,
    analysis: null,
    model: null,
    analysisTruncated: false,
    messages: [],
    source: null,
  };
}

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
