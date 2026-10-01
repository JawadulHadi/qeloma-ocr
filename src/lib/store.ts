import { clear, createStore, del, get, set, values, type UseStore } from 'idb-keyval';
import type { Analysis, FileKind } from '../../shared/types';
import type { ExtractionResult } from './extract/types';

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** Set on a question that didn't get an answer; such turns are not sent back to the AI as history. */
  error?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  file: { name: string; mimeType: string; typeLabel: string; kind: FileKind; size: number; pageCount: number };
  extraction: ExtractionResult;
  /** Text sent to the AI: starts as extraction.text; the user may edit it. */
  text: string;
  textEdited: boolean;
  analysis: Analysis | null;
  model: string | null;
  analysisTruncated: boolean;
  messages: StoredMessage[];
  /** The original file when it is at most MAX_STORED_SOURCE_BYTES, for re-showing the preview. */
  source: Blob | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  fileName: string;
  typeLabel: string;
  kind: FileKind;
  hasAnalysis: boolean;
  messageCount: number;
}

/** Owner of documents read without signing in. They are kept in memory only, never written to disk. */
export const GUEST_ID = 'guest';

// History is kept in IndexedDB, one database per Google account. When IndexedDB is missing or fails
// (private windows, blocked site data), everything falls back to memory for the rest of the session.
let persistent = typeof indexedDB !== 'undefined';
const databases = new Map<string, UseStore>();
const memory = new Map<string, Map<string, Conversation>>();

/** False once history can only be kept in memory: it won't survive a reload of this window. */
export function isPersistent(): boolean {
  return persistent;
}

function databaseFor(userId: string): UseStore {
  let store = databases.get(userId);
  if (!store) {
    store = createStore(`scanwise-${userId}`, 'conversations');
    databases.set(userId, store);
  }
  return store;
}

function memoryFor(userId: string): Map<string, Conversation> {
  let map = memory.get(userId);
  if (!map) {
    map = new Map();
    memory.set(userId, map);
  }
  return map;
}

async function withStorage<T>(
  userId: string,
  inDatabase: (store: UseStore) => Promise<T>,
  inMemory: (map: Map<string, Conversation>) => T,
): Promise<T> {
  if (persistent && userId !== GUEST_ID) {
    try {
      return await inDatabase(databaseFor(userId));
    } catch {
      persistent = false;
    }
  }
  return inMemory(memoryFor(userId));
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'QuotaExceededError';
}

function isConversation(value: unknown): value is Conversation {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Conversation>;
  return (
    typeof c.id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.updatedAt === 'number' &&
    typeof c.file === 'object' &&
    c.file !== null &&
    Array.isArray(c.messages)
  );
}

function summarize(c: Conversation): ConversationSummary {
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    fileName: c.file.name,
    typeLabel: c.file.typeLabel,
    kind: c.file.kind,
    hasAnalysis: c.analysis !== null,
    messageCount: c.messages.length,
  };
}

/** All of a user's conversations, newest first. */
export async function getAllConversations(userId: string): Promise<Conversation[]> {
  const all = await withStorage<unknown[]>(
    userId,
    (store) => values(store),
    (map) => [...map.values()],
  );
  return all.filter(isConversation).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Summaries for the History menu, newest first. */
export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  return (await getAllConversations(userId)).map(summarize);
}

export async function getConversation(userId: string, id: string): Promise<Conversation | null> {
  const found = await withStorage<unknown>(
    userId,
    (store) => get(id, store),
    (map) => map.get(id),
  );
  return isConversation(found) ? found : null;
}

export async function saveConversation(c: Conversation): Promise<void> {
  await withStorage(
    c.userId,
    async (store) => {
      try {
        await set(c.id, c, store);
      } catch (err) {
        if (!c.source || !isQuotaError(err)) throw err;
        // Out of space: keep the conversation and drop the original file, which only re-shows the preview.
        await set(c.id, { ...c, source: null }, store);
      }
    },
    (map) => {
      map.set(c.id, c);
    },
  );
}

export async function deleteConversation(userId: string, id: string): Promise<void> {
  await withStorage(
    userId,
    (store) => del(id, store),
    (map) => {
      map.delete(id);
    },
  );
}

/**
 * Moves the documents read in this tab before signing in into the account that just signed in.
 * Returns the id of the most recent one, or null when there were none.
 */
export async function adoptGuestConversations(userId: string): Promise<string | null> {
  const guest = memory.get(GUEST_ID);
  if (!guest || guest.size === 0 || userId === GUEST_ID) return null;
  const adopted = [...guest.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  // Cleared before the first await, so a second call while this one runs finds nothing to adopt.
  guest.clear();
  for (const c of adopted) await saveConversation({ ...c, userId });
  return adopted[0].id;
}

export async function clearConversations(userId: string): Promise<void> {
  await withStorage(
    userId,
    (store) => clear(store),
    (map) => {
      map.clear();
    },
  );
}
