import { clear, createStore, del, get, set, values, type UseStore } from 'idb-keyval';
import type { Analysis, FileKind } from '../../shared/types';
import type { ExtractionResult } from './extract/types';

/** A passage of a source quoted into a question with "Quote in chat". */
export interface MessageQuote {
  sourceId: string;
  /** The source's label when it was quoted, e.g. "S2". */
  label: string;
  text: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  /** On a question: the passage it is about. */
  quote?: MessageQuote;
  /** Set on a question that didn't get an answer; such turns are not sent back to the AI as history. */
  error?: string;
}

/** Where a source came from. */
export type SourceOrigin = 'upload' | 'drive' | 'onedrive' | 'paste';

export interface SourceFile {
  name: string;
  mimeType: string;
  typeLabel: string;
  kind: FileKind;
  size: number;
  pageCount: number;
}

/** One document in a conversation. */
export interface StoredSource {
  id: string;
  /** "S1", "S2"… fixed for the life of the conversation and never reused, so citations stay valid. */
  label: string;
  /** Sent to the AI (summary and chat) when true. */
  included: boolean;
  origin: SourceOrigin;
  addedAt: number;
  file: SourceFile;
  extraction: ExtractionResult;
  /** Text sent to the AI: starts as extraction.text; the user may edit it. */
  text: string;
  textEdited: boolean;
  /** Bumped on every edit of `text`, so the summary can tell it is out of date. */
  revision: number;
  /** The original file when it is at most MAX_STORED_SOURCE_BYTES, for showing the preview again. */
  blob: Blob | null;
}

export interface Conversation {
  version: 2;
  id: string;
  userId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sources: StoredSource[];
  /** The number in the next source's label. */
  nextSourceNumber: number;
  /** The combined summary of the included sources. */
  analysis: Analysis | null;
  /** What the summary was made from (see analysisKey); differs from the current key when it is out of date. */
  analysisKey: string | null;
  model: string | null;
  analysisTruncated: boolean;
  messages: StoredMessage[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  sourceCount: number;
  /** For search, and the subtitle in History. */
  sourceNames: string[];
  /** The first source's kind, for the icon. */
  kind: FileKind;
  /** The first source's type, or "3 sources". */
  typeLabel: string;
  hasAnalysis: boolean;
  messageCount: number;
}

/** The included sources with text: what the AI reads. */
export function sourcesForAi(c: Pick<Conversation, 'sources'>): StoredSource[] {
  return c.sources.filter((source) => source.included && source.text.trim());
}

/** Identifies which sources, at which edit, a summary was made from. */
export function analysisKey(c: Pick<Conversation, 'sources'>): string {
  return sourcesForAi(c)
    .map((source) => `${source.id}@${source.revision}`)
    .join(',');
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

// ---- Reading stored records (and upgrading those saved before conversations had several sources) ----

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasBase(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.updatedAt === 'number' &&
    Array.isArray(value.messages)
  );
}

/** A version-1 record held exactly one document in top-level fields; it becomes source S1. */
function upgradeV1(v: Record<string, unknown>): Conversation | null {
  if (!isRecord(v.file) || !isRecord(v.extraction)) return null;
  const old = v as unknown as {
    id: string;
    userId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    file: SourceFile;
    extraction: ExtractionResult;
    text: string;
    textEdited: boolean;
    analysis: Analysis | null;
    model: string | null;
    analysisTruncated: boolean;
    messages: StoredMessage[];
    source: Blob | null;
  };
  const source: StoredSource = {
    id: `${old.id}-s1`,
    label: 'S1',
    included: true,
    origin: 'upload',
    addedAt: old.createdAt,
    file: old.file,
    extraction: old.extraction,
    text: typeof old.text === 'string' ? old.text : old.extraction.text,
    textEdited: old.textEdited === true,
    revision: 0,
    blob: old.source instanceof Blob ? old.source : null,
  };
  const sources = [source];
  return {
    version: 2,
    id: old.id,
    userId: old.userId,
    title: old.title,
    createdAt: old.createdAt,
    updatedAt: old.updatedAt,
    sources,
    nextSourceNumber: 2,
    analysis: old.analysis ?? null,
    analysisKey: old.analysis ? analysisKey({ sources }) : null,
    model: old.model ?? null,
    analysisTruncated: old.analysisTruncated === true,
    messages: old.messages,
  };
}

/** A usable conversation from whatever was stored, or null for anything unrecognizable. */
export function readConversation(value: unknown): Conversation | null {
  if (!isRecord(value) || !hasBase(value)) return null;
  if (value.version === 2) return Array.isArray(value.sources) ? (value as unknown as Conversation) : null;
  return upgradeV1(value);
}

function summarize(c: Conversation): ConversationSummary {
  const first = c.sources[0];
  return {
    id: c.id,
    title: c.title,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    sourceCount: c.sources.length,
    sourceNames: c.sources.map((source) => source.file.name),
    kind: first?.file.kind ?? 'text',
    typeLabel: c.sources.length === 1 && first ? first.file.typeLabel : `${c.sources.length} sources`,
    hasAnalysis: c.analysis !== null,
    messageCount: c.messages.length,
  };
}

// ---- Access ----------------------------------------------------------------------------------------------------

/** All of a user's conversations, newest first. */
export async function getAllConversations(userId: string): Promise<Conversation[]> {
  const all = await withStorage<unknown[]>(
    userId,
    (store) => values(store),
    (map) => [...map.values()],
  );
  return all
    .map(readConversation)
    .filter((c): c is Conversation => c !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
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
  return readConversation(found);
}

export async function saveConversation(c: Conversation): Promise<void> {
  await withStorage(
    c.userId,
    async (store) => {
      try {
        await set(c.id, c, store);
      } catch (err) {
        if (!c.sources.some((source) => source.blob) || !isQuotaError(err)) throw err;
        // Out of space: keep the conversation and drop the original files, which only show the previews.
        await set(c.id, { ...c, sources: c.sources.map((source) => ({ ...source, blob: null })) }, store);
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
