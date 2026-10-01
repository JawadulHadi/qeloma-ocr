import { useCallback, useEffect, useRef, useState } from 'react';
import { shareBudget } from '../../shared/budget';
import {
  MAX_ANALYZE_CHARS,
  MAX_CHAT_HISTORY,
  MAX_CHAT_TURN_CHARS,
  MAX_QUESTION_CHARS,
  MAX_QUOTE_CHARS,
  MAX_SOURCES,
  MAX_STORED_SOURCE_BYTES,
} from '../../shared/limits';
import type { ChatTurn, DocumentMeta, SessionUser, SourceInput } from '../../shared/types';
import { analyzeSources, errorMessage, isAbortError, readWithVision, streamChat, ApiError } from '../lib/api';
import { expandBundles, type SkippedFile } from '../lib/bundle';
import { downloadMarkdown } from '../lib/download';
import {
  AI_VISION_MISSING,
  ExtractionAbortedError,
  UnsupportedFileError,
  extractText,
  type ExtractProgress,
} from '../lib/extract';
import { conversationToMarkdown, conversationsToMarkdown, markdownFilename } from '../lib/markdown';
import { readPrefs } from '../lib/prefs';
import {
  GUEST_ID,
  adoptGuestConversations,
  analysisKey,
  clearConversations,
  deleteConversation,
  getAllConversations,
  getConversation,
  listConversations,
  saveConversation,
  sourcesForAi,
  type Conversation,
  type ConversationSummary,
  type MessageQuote,
  type SourceOrigin,
  type StoredMessage,
  type StoredSource,
} from '../lib/store';

/** A file waiting to be read, being read, or that couldn't be read. */
export interface ReadingItem {
  id: string;
  name: string;
  size: number;
  origin: SourceOrigin;
  status: 'waiting' | 'reading' | 'failed';
  progress: ExtractProgress | null;
  /** Why it couldn't be read, when status is 'failed'. */
  error: string | null;
}

export interface WorkspaceState {
  conversation: Conversation | null;
  /** Files in the order they were added. Read files leave the list; failed ones stay until dismissed. */
  reading: ReadingItem[];
  analysis: { running: boolean; error: string | null };
  /** `draft` is the partial assistant answer while it streams. */
  chat: { streaming: boolean; draft: string; error: string | null };
}

const IDLE_ANALYSIS: WorkspaceState['analysis'] = { running: false, error: null };
const IDLE_CHAT: WorkspaceState['chat'] = { streaming: false, draft: '', error: null };

const EMPTY_STATE: WorkspaceState = { conversation: null, reading: [], analysis: IDLE_ANALYSIS, chat: IDLE_CHAT };

const READ_FAILED = "Couldn't read this file. Try another file or set Reading to AI vision.";
const ANALYZE_FAILED = "Couldn't summarize the sources. Try again.";
const CHAT_FAILED = "Couldn't get an answer. Try again.";
const NO_SOURCES_FOR_CHAT = 'Tick at least one source with text to ask about.';
const VISION_NEEDS_SIGN_IN = 'AI vision needs you to sign in. Sign in, or set Reading to On-device and try again.';
const TOO_MANY_SOURCES = `A conversation holds up to ${MAX_SOURCES} sources. Start a new one for the rest.`;
const EMPTY_ANSWER = "The AI didn't answer. Try asking again.";
/** Asked when someone sends a quoted passage without typing anything. */
export const DEFAULT_QUOTE_QUESTION = 'What does this passage mean for me?';
const STOPPED_SUFFIX = ' _(stopped)_';
const SAVE_DELAY_MS = 500;
/** Room kept in a question for the quoted passage: the quote itself, its "> " prefixes and the label. */
export const QUOTE_RESERVE_CHARS = MAX_QUOTE_CHARS + 300;

// ---- Pure helpers (unit-tested) -----------------------------------------------------------------

/** The file name without its extension, as the title until the analysis provides one. */
export function titleFromFileName(name: string): string {
  const title = name.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  return title || 'Untitled document';
}

export function documentMeta(source: StoredSource): DocumentMeta {
  return {
    fileName: source.file.name,
    mimeType: source.file.mimeType,
    kind: source.file.kind,
    pageCount: source.file.pageCount,
    meanConfidence: source.extraction.meanConfidence,
    engine: source.extraction.engineLabel,
  };
}

/** The sources as sent to the AI, trimmed the same way the server would so the request stays small. */
export function toSourceInputs(sources: StoredSource[]): SourceInput[] {
  const texts = sources.map((source) => source.text.trim());
  const allowed = shareBudget(
    texts.map((text) => text.length),
    MAX_ANALYZE_CHARS,
  );
  return sources.map((source, index) => ({
    label: source.label,
    text: texts[index].slice(0, allowed[index]),
    document: documentMeta(source),
  }));
}

/** A question as the AI reads it: the quoted passage as a Markdown quote with its label, then what was asked. */
export function composeQuestion(question: string, quote?: MessageQuote): string {
  if (!quote) return question;
  const passage = quote.text
    .slice(0, MAX_QUOTE_CHARS)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n')
    .slice(0, QUOTE_RESERVE_CHARS - 20);
  return `${passage} [${quote.label}]\n\n${question}`.slice(0, MAX_QUESTION_CHARS);
}

/**
 * Previous turns for the AI: only answered questions and their answers (a question that failed or was
 * stopped before any answer is left out), newest MAX_CHAT_HISTORY, each turn capped in length.
 */
export function toChatHistory(messages: StoredMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  messages.forEach((message, index) => {
    if (message.error || !message.content.trim()) return;
    if (message.role === 'user') {
      const next = messages[index + 1];
      if (!next || next.role !== 'assistant' || next.error || !next.content.trim()) return;
    }
    const content = message.role === 'user' ? composeQuestion(message.content, message.quote) : message.content;
    turns.push({ role: message.role, content: content.slice(0, MAX_CHAT_TURN_CHARS) });
  });
  return turns.slice(-MAX_CHAT_HISTORY);
}

/** The message an extraction error shows: our own sentences as they are, anything unexpected as a generic one. */
export function extractionErrorMessage(err: unknown): string {
  if (err instanceof UnsupportedFileError || err instanceof ApiError) return err.message;
  // The extraction module throws plain Errors with sentences written for the reader.
  if (err instanceof Error && err.name === 'Error' && err.message) return err.message;
  return READ_FAILED;
}

export function isCancellation(err: unknown): boolean {
  return err instanceof ExtractionAbortedError || isAbortError(err);
}

/** True when the summary was made from a different set of sources (or text) than is included now. */
export function isAnalysisStale(c: Conversation): boolean {
  return c.analysis !== null && c.analysisKey !== analysisKey(c);
}

function newId(): string {
  return crypto.randomUUID();
}

function newConversation(userId: string, title: string): Conversation {
  const now = Date.now();
  return {
    version: 2,
    id: newId(),
    userId,
    title,
    createdAt: now,
    updatedAt: now,
    sources: [],
    nextSourceNumber: 1,
    analysis: null,
    analysisKey: null,
    model: null,
    analysisTruncated: false,
    messages: [],
  };
}

// ---- The controller ---------------------------------------------------------------------------------

/** `user` is null for someone who hasn't signed in: files are read on the device and nothing goes to the AI. */
export function useConversation(user: SessionUser | null) {
  const [state, setState] = useState<WorkspaceState>(EMPTY_STATE);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  // The latest state, readable from async work without waiting for a render.
  const stateRef = useRef(state);
  /** The files behind waiting and reading items. */
  const pendingFiles = useRef(new Map<string, File>());
  /** The item being read and how to stop it. */
  const readingNow = useRef<{ id: string; controller: AbortController } | null>(null);
  /** Set while the queue is being worked through. */
  const pumping = useRef(false);
  const analysisOperation = useRef<AbortController | null>(null);
  const chatOperation = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | null>(null);
  const userId = user?.id ?? GUEST_ID;
  const guest = user === null;
  /** Documents read before signing in, moved into this account; started once per mount. */
  const adoption = useRef<Promise<string | null> | null>(null);

  const update = useCallback((patch: Partial<WorkspaceState>) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<ReadingItem>) => {
      update({ reading: stateRef.current.reading.map((item) => (item.id === id ? { ...item, ...patch } : item)) });
    },
    [update],
  );

  const removeItem = useCallback(
    (id: string) => {
      pendingFiles.current.delete(id);
      update({ reading: stateRef.current.reading.filter((item) => item.id !== id) });
    },
    [update],
  );

  const refreshHistory = useCallback(async () => {
    try {
      setHistory(await listConversations(userId));
    } catch {
      // History stays as it was; the next save tries again.
    }
  }, [userId]);

  const persist = useCallback(
    async (c: Conversation) => {
      try {
        await saveConversation(c);
      } catch {
        // Storage refused (quota): the conversation still works for this visit.
      }
      await refreshHistory();
    },
    [refreshHistory],
  );

  const flushPendingSave = useCallback(() => {
    if (saveTimer.current === null) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const c = stateRef.current.conversation;
    if (c) void persist(c);
  }, [persist]);

  /** Replaces the conversation everywhere: state, and (now or debounced) storage. */
  const commit = useCallback(
    (c: Conversation, patch: Partial<WorkspaceState> = {}, save: 'now' | 'later' = 'now') => {
      update({ ...patch, conversation: c });
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (save === 'now') void persist(c);
      else
        saveTimer.current = window.setTimeout(() => {
          saveTimer.current = null;
          void persist(c);
        }, SAVE_DELAY_MS);
    },
    [update, persist],
  );

  /** Changes the open conversation, if there is one. */
  const change = useCallback(
    (edit: (c: Conversation) => Conversation, save: 'now' | 'later' = 'now') => {
      const c = stateRef.current.conversation;
      if (c) commit({ ...edit(c), updatedAt: Date.now() }, {}, save);
    },
    [commit],
  );

  const stopChat = useCallback(() => {
    chatOperation.current?.abort();
    chatOperation.current = null;
  }, []);

  const stopAnalysis = useCallback(() => {
    analysisOperation.current?.abort();
    analysisOperation.current = null;
  }, []);

  /** Stops reading and forgets every file still waiting. Failed items are dropped too. */
  const stopReading = useCallback(() => {
    readingNow.current?.controller.abort();
    readingNow.current = null;
    pendingFiles.current.clear();
  }, []);

  /** Everything in flight, before the workspace switches to another conversation (or none). */
  const stopEverything = useCallback(() => {
    stopReading();
    stopAnalysis();
    stopChat();
    flushPendingSave();
  }, [flushPendingSave, stopAnalysis, stopChat, stopReading]);

  useEffect(
    () => () => {
      readingNow.current?.controller.abort();
      analysisOperation.current?.abort();
      chatOperation.current?.abort();
      flushPendingSave();
    },
    [flushPendingSave],
  );

  // ---- Summary --------------------------------------------------------------------------------------

  const analyze = useCallback(async () => {
    const c = stateRef.current.conversation;
    const sources = c ? sourcesForAi(c) : [];
    if (guest || !c || sources.length === 0) return;
    flushPendingSave();
    stopAnalysis();
    const controller = new AbortController();
    analysisOperation.current = controller;
    const key = analysisKey(c);
    update({ analysis: { running: true, error: null } });
    try {
      const result = await analyzeSources({ sources: toSourceInputs(sources) }, controller.signal);
      if (analysisOperation.current !== controller) return;
      analysisOperation.current = null;
      const latest = stateRef.current.conversation;
      if (!latest || latest.id !== c.id) return;
      commit(
        {
          ...latest,
          title: result.analysis.title.trim() || latest.title,
          analysis: result.analysis,
          analysisKey: key,
          model: result.model,
          analysisTruncated: result.truncated,
          updatedAt: Date.now(),
        },
        { analysis: IDLE_ANALYSIS },
      );
    } catch (err) {
      if (analysisOperation.current !== controller) return;
      analysisOperation.current = null;
      update({ analysis: isCancellation(err) ? IDLE_ANALYSIS : { running: false, error: errorMessage(err, ANALYZE_FAILED) } });
    }
  }, [commit, flushPendingSave, guest, stopAnalysis, update]);

  const cancelAnalysis = useCallback(() => {
    stopAnalysis();
    update({ analysis: IDLE_ANALYSIS });
  }, [stopAnalysis, update]);

  // ---- Reading -------------------------------------------------------------------------------------

  /** Adds a read file to the open conversation, starting one if there is none. Returns that conversation's id. */
  const addSource = useCallback(
    (file: File, extraction: StoredSource['extraction'], origin: SourceOrigin): string => {
      const c = stateRef.current.conversation ?? newConversation(userId, titleFromFileName(file.name));
      const now = Date.now();
      const source: StoredSource = {
        id: newId(),
        label: `S${c.nextSourceNumber}`,
        included: true,
        origin,
        addedAt: now,
        file: {
          name: file.name,
          mimeType: extraction.mimeType,
          typeLabel: extraction.typeLabel,
          kind: extraction.kind,
          size: file.size,
          pageCount: Math.max(1, extraction.pages.length),
        },
        extraction,
        text: extraction.text,
        textEdited: false,
        revision: 0,
        blob: file.size <= MAX_STORED_SOURCE_BYTES ? file : null,
      };
      commit({
        ...c,
        // Until there is a summary, the conversation is named after its first source.
        title: c.sources.length === 0 && !c.analysis ? titleFromFileName(file.name) : c.title,
        sources: [...c.sources, source],
        nextSourceNumber: c.nextSourceNumber + 1,
        updatedAt: now,
      });
      return c.id;
    },
    [commit, userId],
  );

  /** Reads one queued file into the open conversation. Returns the conversation's id, or null if nothing was added. */
  const readOne = useCallback(
    async (item: ReadingItem): Promise<string | null> => {
      const file = pendingFiles.current.get(item.id);
      if (!file) {
        removeItem(item.id);
        return null;
      }
      const controller = new AbortController();
      readingNow.current = { id: item.id, controller };
      updateItem(item.id, { status: 'reading', progress: { phase: 'preparing', ratio: 0, label: 'Getting the file ready…' } });
      try {
        const prefs = readPrefs();
        const extraction = await extractText(file, {
          mode: prefs.mode,
          language: prefs.language,
          vision: guest ? undefined : readWithVision,
          signal: controller.signal,
          onProgress: (progress) => {
            if (readingNow.current?.controller === controller) updateItem(item.id, { progress });
          },
        });
        if (controller.signal.aborted) return null;
        const conversationId = addSource(file, extraction, item.origin);
        removeItem(item.id);
        return conversationId;
      } catch (err) {
        if (controller.signal.aborted || isCancellation(err)) {
          removeItem(item.id);
          return null;
        }
        const needsSignIn = guest && err instanceof Error && err.message === AI_VISION_MISSING;
        pendingFiles.current.delete(item.id);
        updateItem(item.id, {
          status: 'failed',
          progress: null,
          error: needsSignIn ? VISION_NEEDS_SIGN_IN : extractionErrorMessage(err),
        });
        return null;
      } finally {
        if (readingNow.current?.controller === controller) readingNow.current = null;
      }
    },
    [addSource, guest, removeItem, updateItem],
  );

  /** Reads waiting files one after another; once none are left, summarizes a conversation that has no summary yet. */
  const pump = useCallback(async () => {
    if (pumping.current) return;
    pumping.current = true;
    let addedTo: string | null = null;
    try {
      for (;;) {
        const next = stateRef.current.reading.find((item) => item.status === 'waiting');
        if (!next) break;
        addedTo = (await readOne(next)) ?? addedTo;
      }
    } finally {
      pumping.current = false;
    }
    // Only the conversation the files went into: the reader may have opened another one meanwhile.
    const c = stateRef.current.conversation;
    if (c && c.id === addedTo && !c.analysis && !stateRef.current.analysis.running && !readPrefs().reviewBeforeAnalysis) {
      await analyze();
    }
  }, [analyze, readOne]);

  /**
   * Queues files to read, unpacking ZIP archives first. `alreadySkipped` lists files a picker couldn't fetch,
   * shown alongside the files that can't be read.
   */
  const addFiles = useCallback(
    async (picked: readonly File[], origin: SourceOrigin = 'upload', alreadySkipped: readonly SkippedFile[] = []) => {
      if (picked.length === 0 && alreadySkipped.length === 0) return;
      const bundle = await expandBundles(picked);
      const { files } = bundle;
      const skipped = [...alreadySkipped, ...bundle.skipped];
      const pending = stateRef.current.reading.filter((item) => item.status !== 'failed').length;
      let room = MAX_SOURCES - (stateRef.current.conversation?.sources.length ?? 0) - pending;
      const items: ReadingItem[] = [];
      for (const file of files) {
        const id = newId();
        const fits = room > 0;
        room -= 1;
        if (fits) pendingFiles.current.set(id, file);
        items.push({
          id,
          name: file.name,
          size: file.size,
          origin,
          status: fits ? 'waiting' : 'failed',
          progress: null,
          error: fits ? null : TOO_MANY_SOURCES,
        });
      }
      for (const skip of skipped) {
        items.push({ id: newId(), name: skip.name, size: 0, origin, status: 'failed', progress: null, error: skip.reason });
      }
      update({ reading: [...stateRef.current.reading, ...items] });
      await pump();
    },
    [pump, update],
  );

  /** Adds pasted text as a source. */
  const addText = useCallback(
    async (title: string, text: string) => {
      const name = `${title.trim().replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 80) || 'Pasted text'}.txt`;
      await addFiles([new File([text], name, { type: 'text/plain' })], 'paste');
    },
    [addFiles],
  );

  /** Stops reading one file (or forgets it while it waits), or dismisses one that failed. */
  const cancelReading = useCallback(
    (id: string) => {
      if (readingNow.current?.id === id) readingNow.current.controller.abort();
      removeItem(id);
    },
    [removeItem],
  );

  /** Stops reading and forgets every waiting file. */
  const cancelAllReading = useCallback(() => {
    stopReading();
    update({ reading: stateRef.current.reading.filter((item) => item.status === 'failed') });
  }, [stopReading, update]);

  // ---- Sources ---------------------------------------------------------------------------------------

  const setSourceIncluded = useCallback(
    (id: string, included: boolean) => {
      change((c) => ({ ...c, sources: c.sources.map((source) => (source.id === id ? { ...source, included } : source)) }));
    },
    [change],
  );

  const setAllIncluded = useCallback(
    (included: boolean) => {
      change((c) => ({ ...c, sources: c.sources.map((source) => ({ ...source, included })) }));
    },
    [change],
  );

  const removeSource = useCallback(
    (id: string) => {
      change((c) => ({ ...c, sources: c.sources.filter((source) => source.id !== id) }));
    },
    [change],
  );

  const updateSourceText = useCallback(
    (id: string, text: string) => {
      change(
        (c) => ({
          ...c,
          sources: c.sources.map((source) =>
            source.id === id && source.text !== text
              ? { ...source, text, textEdited: text !== source.extraction.text, revision: source.revision + 1 }
              : source,
          ),
        }),
        'later',
      );
    },
    [change],
  );

  // ---- Chat --------------------------------------------------------------------------------------------

  const ask = useCallback(
    async (typed: string, quote?: MessageQuote) => {
      const question = typed.trim() || (quote ? DEFAULT_QUOTE_QUESTION : '');
      const c = stateRef.current.conversation;
      if (guest || !c || !question || stateRef.current.chat.streaming) return;
      const sources = sourcesForAi(c);

      // "Try again" re-asks a question that failed; don't keep the failed copy.
      const last = c.messages.at(-1);
      const retry = last?.role === 'user' && last.error && last.content === question && last.quote?.text === quote?.text;
      const previous = retry ? c.messages.slice(0, -1) : c.messages;
      const userMessage: StoredMessage = {
        id: newId(),
        role: 'user',
        content: question,
        createdAt: Date.now(),
        ...(quote ? { quote } : {}),
      };
      const withQuestion: Conversation = { ...c, messages: [...previous, userMessage], updatedAt: Date.now() };

      const fail = (message: string) => {
        const current = stateRef.current.conversation ?? withQuestion;
        commit(
          { ...current, messages: current.messages.map((m) => (m.id === userMessage.id ? { ...m, error: message } : m)) },
          { chat: { streaming: false, draft: '', error: message } },
        );
      };
      if (sources.length === 0) {
        commit(withQuestion);
        fail(NO_SOURCES_FOR_CHAT);
        return;
      }
      commit(withQuestion, { chat: { streaming: true, draft: '', error: null } });

      stopChat();
      const controller = new AbortController();
      chatOperation.current = controller;
      try {
        const answer = await streamChat(
          {
            sources: toSourceInputs(sources),
            analysis: isAnalysisStale(c) ? null : c.analysis,
            history: toChatHistory(previous),
            question: composeQuestion(question, quote),
          },
          {
            signal: controller.signal,
            onChunk: (draft) => {
              if (chatOperation.current === controller) update({ chat: { streaming: true, draft, error: null } });
            },
          },
        );
        if (chatOperation.current !== controller) return;
        if (!answer.trim()) throw new Error(EMPTY_ANSWER);
        chatOperation.current = null;
        const current = stateRef.current.conversation ?? withQuestion;
        const reply: StoredMessage = { id: newId(), role: 'assistant', content: answer, createdAt: Date.now() };
        commit({ ...current, messages: [...current.messages, reply], updatedAt: Date.now() }, { chat: IDLE_CHAT });
      } catch (err) {
        // Stopped, or the reader moved to another conversation.
        if (chatOperation.current !== controller) return;
        chatOperation.current = null;
        if (isCancellation(err)) {
          update({ chat: IDLE_CHAT });
          return;
        }
        fail(err instanceof Error && err.message === EMPTY_ANSWER ? EMPTY_ANSWER : errorMessage(err, CHAT_FAILED));
      }
    },
    [commit, guest, stopChat, update],
  );

  const stopAnswer = useCallback(() => {
    if (!stateRef.current.chat.streaming) return;
    const draft = stateRef.current.chat.draft;
    stopChat();
    const c = stateRef.current.conversation;
    if (!c) return;
    if (draft.trim()) {
      const reply: StoredMessage = { id: newId(), role: 'assistant', content: `${draft}${STOPPED_SUFFIX}`, createdAt: Date.now() };
      commit({ ...c, messages: [...c.messages, reply], updatedAt: Date.now() }, { chat: IDLE_CHAT });
    } else {
      update({ chat: IDLE_CHAT });
    }
  }, [commit, stopChat, update]);

  // ---- Conversations ---------------------------------------------------------------------------------

  const open = useCallback(
    async (id: string) => {
      if (stateRef.current.conversation?.id === id) return;
      stopEverything();
      const c = await getConversation(userId, id).catch(() => null);
      if (!c) {
        await refreshHistory();
        return;
      }
      update({ ...EMPTY_STATE, conversation: c });
    },
    [refreshHistory, stopEverything, update, userId],
  );

  // Loads the history, after first bringing in anything read in this tab before signing in, and opens that.
  useEffect(() => {
    let active = true;
    adoption.current ??= guest ? Promise.resolve(null) : adoptGuestConversations(userId).catch(() => null);
    void adoption.current.then(async (adoptedId) => {
      if (!active) return;
      await refreshHistory();
      if (adoptedId && active) await open(adoptedId);
    });
    return () => {
      active = false;
    };
  }, [guest, open, refreshHistory, userId]);

  const reset = useCallback(() => {
    stopEverything();
    update({ ...EMPTY_STATE });
  }, [stopEverything, update]);

  const remove = useCallback(
    async (id: string) => {
      if (stateRef.current.conversation?.id === id) {
        if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
        reset();
      }
      await deleteConversation(userId, id).catch(() => undefined);
      await refreshHistory();
    },
    [refreshHistory, reset, userId],
  );

  const clearHistory = useCallback(async () => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = null;
    reset();
    await clearConversations(userId).catch(() => undefined);
    await refreshHistory();
  }, [refreshHistory, reset, userId]);

  const exportCurrent = useCallback(() => {
    const c = stateRef.current.conversation;
    if (c) downloadMarkdown(markdownFilename(c), conversationToMarkdown(c));
  }, []);

  const exportAll = useCallback(async () => {
    flushPendingSave();
    const all = await getAllConversations(userId).catch(() => []);
    if (all.length > 0) downloadMarkdown(markdownFilename(null), conversationsToMarkdown(all));
  }, [flushPendingSave, userId]);

  return {
    guest,
    state,
    history,
    addFiles,
    addText,
    cancelReading,
    cancelAllReading,
    setSourceIncluded,
    setAllIncluded,
    removeSource,
    updateSourceText,
    analyze,
    cancelAnalysis,
    ask,
    stopAnswer,
    open,
    reset,
    remove,
    clearHistory,
    exportCurrent,
    exportAll,
  };
}

export type ConversationController = ReturnType<typeof useConversation>;
