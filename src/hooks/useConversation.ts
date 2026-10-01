import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_CHAT_HISTORY, MAX_CHAT_TURN_CHARS, MAX_STORED_SOURCE_BYTES } from '../../shared/limits';
import type { ChatTurn, DocumentMeta, FileKind, SessionUser } from '../../shared/types';
import { analyzeText, errorMessage, isAbortError, readWithVision, streamChat, ApiError } from '../lib/api';
import { downloadMarkdown } from '../lib/download';
import {
  ExtractionAbortedError,
  UnsupportedFileError,
  detectFile,
  extractText,
  makePreview,
  type DetectedFile,
  type ExtractProgress,
  type FilePreview,
} from '../lib/extract';
import { conversationToMarkdown, conversationsToMarkdown, markdownFilename } from '../lib/markdown';
import { readPrefs } from '../lib/prefs';
import {
  clearConversations,
  deleteConversation,
  getAllConversations,
  getConversation,
  listConversations,
  saveConversation,
  type Conversation,
  type ConversationSummary,
  type StoredMessage,
} from '../lib/store';

export type Phase = 'empty' | 'preparing' | 'extracting' | 'review' | 'analyzing' | 'ready' | 'error';

/** What is known about the file being read before a conversation exists for it. */
export interface PendingFile {
  name: string;
  size: number;
  kind?: FileKind;
  mimeType?: string;
  typeLabel?: string;
}

export interface WorkspaceState {
  phase: Phase;
  conversation: Conversation | null;
  /** Object URL owned and revoked by the hook. */
  preview: FilePreview | null;
  /** During 'preparing' and 'extracting'. */
  progress: ExtractProgress | null;
  /** The file being read, until its conversation exists. */
  pendingFile: PendingFile | null;
  error: { stage: 'extract' | 'analyze'; message: string } | null;
  /** `draft` is the partial assistant answer while it streams. */
  chat: { streaming: boolean; draft: string; error: string | null };
}

const IDLE_CHAT: WorkspaceState['chat'] = { streaming: false, draft: '', error: null };

const EMPTY_STATE: WorkspaceState = {
  phase: 'empty',
  conversation: null,
  preview: null,
  progress: null,
  pendingFile: null,
  error: null,
  chat: IDLE_CHAT,
};

const READ_FAILED = "Couldn't read this file. Try another file or set Reading to AI vision.";
const ANALYZE_FAILED = "Couldn't analyze the text. Try again.";
const CHAT_FAILED = "Couldn't get an answer. Try again.";
const EMPTY_ANSWER = "The AI didn't answer. Try asking again.";
const STOPPED_SUFFIX = ' _(stopped)_';
const SAVE_DELAY_MS = 500;

// ---- Pure helpers (unit-tested) -----------------------------------------------------------------

/** The file name without its extension, as the title until the analysis provides one. */
export function titleFromFileName(name: string): string {
  const title = name.replace(/\.[a-z0-9]{1,8}$/i, '').trim();
  return title || 'Untitled document';
}

export function documentMeta(c: Conversation): DocumentMeta {
  return {
    fileName: c.file.name,
    mimeType: c.file.mimeType,
    kind: c.file.kind,
    pageCount: c.file.pageCount,
    meanConfidence: c.extraction.meanConfidence,
    engine: c.extraction.engineLabel,
  };
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
    turns.push({ role: message.role, content: message.content.slice(0, MAX_CHAT_TURN_CHARS) });
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

function extensionOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
}

function newId(): string {
  return crypto.randomUUID();
}

// ---- The controller ---------------------------------------------------------------------------------

export function useConversation(user: SessionUser) {
  const [state, setState] = useState<WorkspaceState>(EMPTY_STATE);
  const [history, setHistory] = useState<ConversationSummary[]>([]);
  // The latest state, readable from async work without waiting for a render.
  const stateRef = useRef(state);
  /** The extraction, analysis or history load in flight; replaced (and aborted) by the next one. */
  const operation = useRef<AbortController | null>(null);
  const chatOperation = useRef<AbortController | null>(null);
  const saveTimer = useRef<number | null>(null);
  const userId = user.id;

  const update = useCallback((patch: Partial<WorkspaceState>) => {
    const current = stateRef.current;
    const next = { ...current, ...patch };
    if (current.preview && next.preview !== current.preview) URL.revokeObjectURL(current.preview.url);
    stateRef.current = next;
    setState(next);
  }, []);

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
    (c: Conversation, patch: Partial<WorkspaceState> = {}, save: 'now' | 'later' | 'no' = 'now') => {
      update({ ...patch, conversation: c });
      if (save === 'no') return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
      if (save === 'now') void persist(c);
      else saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        void persist(c);
      }, SAVE_DELAY_MS);
    },
    [update, persist],
  );

  const beginOperation = useCallback(() => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    return controller;
  }, []);

  const stopChat = useCallback(() => {
    chatOperation.current?.abort();
    chatOperation.current = null;
  }, []);

  useEffect(() => {
    void refreshHistory();
  }, [refreshHistory]);

  useEffect(
    () => () => {
      operation.current?.abort();
      chatOperation.current?.abort();
      flushPendingSave();
      const preview = stateRef.current.preview;
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [flushPendingSave],
  );

  const analyze = useCallback(async () => {
    const c = stateRef.current.conversation;
    if (!c || !c.text.trim()) return;
    flushPendingSave();
    const controller = beginOperation();
    update({ phase: 'analyzing', error: null });
    try {
      const result = await analyzeText({ text: c.text, document: documentMeta(c) }, controller.signal);
      if (operation.current !== controller) return;
      operation.current = null;
      const latest = stateRef.current.conversation ?? c;
      commit(
        {
          ...latest,
          title: result.analysis.title.trim() || latest.title,
          analysis: result.analysis,
          model: result.model,
          analysisTruncated: result.truncated,
          updatedAt: Date.now(),
        },
        { phase: 'ready', error: null },
      );
    } catch (err) {
      if (operation.current !== controller || isCancellation(err)) return;
      operation.current = null;
      update({ phase: 'error', error: { stage: 'analyze', message: errorMessage(err, ANALYZE_FAILED) } });
    }
  }, [beginOperation, commit, flushPendingSave, update]);

  const startFile = useCallback(
    async (file: File) => {
      stopChat();
      flushPendingSave();
      const controller = beginOperation();
      const { signal } = controller;
      update({
        ...EMPTY_STATE,
        phase: 'preparing',
        pendingFile: { name: file.name, size: file.size },
        progress: { phase: 'preparing', ratio: 0, label: 'Getting the file ready…' },
      });

      try {
        const detected = await detectFile(file);
        if (signal.aborted) return;
        update({ pendingFile: { name: file.name, size: file.size, kind: detected.kind, mimeType: detected.mimeType, typeLabel: detected.label } });

        const preview = await makePreview(file, detected);
        if (signal.aborted) {
          if (preview) URL.revokeObjectURL(preview.url);
          return;
        }
        update({ phase: 'extracting', preview });

        const prefs = readPrefs();
        const extraction = await extractText(file, {
          mode: prefs.mode,
          language: prefs.language,
          vision: readWithVision,
          signal,
          onProgress: (progress) => {
            if (operation.current === controller) update({ progress });
          },
        });
        if (operation.current !== controller) return;
        operation.current = null;

        const now = Date.now();
        const conversation: Conversation = {
          id: newId(),
          userId,
          title: titleFromFileName(file.name),
          createdAt: now,
          updatedAt: now,
          file: {
            name: file.name,
            mimeType: detected.mimeType,
            typeLabel: detected.label,
            kind: detected.kind,
            size: file.size,
            pageCount: Math.max(1, extraction.pages.length),
          },
          extraction,
          text: extraction.text,
          textEdited: false,
          analysis: null,
          model: null,
          analysisTruncated: false,
          messages: [],
          source: file.size <= MAX_STORED_SOURCE_BYTES ? file : null,
        };
        const review = prefs.reviewBeforeAnalysis || !conversation.text.trim();
        commit(conversation, { phase: review ? 'review' : 'analyzing', progress: null, pendingFile: null });
        if (!review) await analyze();
      } catch (err) {
        if (operation.current !== controller || isCancellation(err)) return;
        operation.current = null;
        update({
          ...EMPTY_STATE,
          phase: 'error',
          error: { stage: 'extract', message: extractionErrorMessage(err) },
        });
      }
    },
    [analyze, beginOperation, commit, flushPendingSave, stopChat, update, userId],
  );

  const cancel = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    const c = stateRef.current.conversation;
    if (c) update({ phase: c.analysis ? 'ready' : 'review', progress: null, error: null });
    else update({ ...EMPTY_STATE });
  }, [update]);

  const updateText = useCallback(
    (text: string) => {
      const c = stateRef.current.conversation;
      if (!c || text === c.text) return;
      commit({ ...c, text, textEdited: text !== c.extraction.text, updatedAt: Date.now() }, {}, 'later');
    },
    [commit],
  );

  const ask = useCallback(
    async (question: string) => {
      const asked = question.trim();
      const c = stateRef.current.conversation;
      if (!c || !asked || stateRef.current.chat.streaming) return;

      // "Try again" re-asks a question that failed; don't keep the failed copy.
      const last = c.messages.at(-1);
      const previous = last?.role === 'user' && last.error && last.content === asked ? c.messages.slice(0, -1) : c.messages;
      const userMessage: StoredMessage = { id: newId(), role: 'user', content: asked, createdAt: Date.now() };
      const withQuestion: Conversation = { ...c, messages: [...previous, userMessage], updatedAt: Date.now() };
      commit(withQuestion, { chat: { streaming: true, draft: '', error: null } });

      stopChat();
      const controller = new AbortController();
      chatOperation.current = controller;
      try {
        const answer = await streamChat(
          { text: c.text, document: documentMeta(c), analysis: c.analysis, history: toChatHistory(previous), question: asked },
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
        // Stopped, superseded by a new document, or the reader moved to another conversation.
        if (chatOperation.current !== controller) return;
        chatOperation.current = null;
        if (isCancellation(err)) {
          update({ chat: IDLE_CHAT });
          return;
        }
        const message = err instanceof Error && err.message === EMPTY_ANSWER ? EMPTY_ANSWER : errorMessage(err, CHAT_FAILED);
        const current = stateRef.current.conversation ?? withQuestion;
        commit(
          {
            ...current,
            messages: current.messages.map((m) => (m.id === userMessage.id ? { ...m, error: message } : m)),
          },
          { chat: { streaming: false, draft: '', error: message } },
        );
      }
    },
    [commit, stopChat, update],
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

  const open = useCallback(
    async (id: string) => {
      if (stateRef.current.conversation?.id === id && stateRef.current.phase !== 'error') return;
      stopChat();
      flushPendingSave();
      const controller = beginOperation();
      const c = await getConversation(userId, id).catch(() => null);
      if (operation.current !== controller) return;
      if (!c) {
        operation.current = null;
        await refreshHistory();
        return;
      }
      let preview: FilePreview | null = null;
      if (c.source) {
        const file = c.source instanceof File ? c.source : new File([c.source], c.file.name, { type: c.file.mimeType });
        const detected: DetectedFile = { kind: c.file.kind, mimeType: c.file.mimeType, label: c.file.typeLabel, ext: extensionOf(c.file.name) };
        preview = await makePreview(file, detected);
      }
      if (operation.current !== controller) {
        if (preview) URL.revokeObjectURL(preview.url);
        return;
      }
      operation.current = null;
      update({ ...EMPTY_STATE, phase: c.analysis ? 'ready' : 'review', conversation: c, preview });
    },
    [beginOperation, flushPendingSave, refreshHistory, stopChat, update, userId],
  );

  const reset = useCallback(() => {
    operation.current?.abort();
    operation.current = null;
    stopChat();
    flushPendingSave();
    update({ ...EMPTY_STATE });
  }, [flushPendingSave, stopChat, update]);

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
    state,
    history,
    startFile,
    cancel,
    updateText,
    analyze,
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
