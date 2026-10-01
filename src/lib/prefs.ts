import { useSyncExternalStore } from 'react';
import type { EngineMode } from './extract/types';

export interface Prefs {
  /** How images and scanned pages are read. */
  mode: EngineMode;
  /** Tesseract language code(s), e.g. "eng" or "eng+urd". */
  language: string;
  /** Stop after extraction so the text can be checked before it goes to the AI. */
  reviewBeforeAnalysis: boolean;
}

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({ mode: 'auto', language: 'eng', reviewBeforeAnalysis: false });

const STORAGE_KEY = 'scanwise.prefs';
const ENGINE_MODES: readonly string[] = ['auto', 'local', 'ai'] satisfies EngineMode[];
/** Tesseract codes such as "eng", "chi_sim" or "eng+urd". */
const LANGUAGE_PATTERN = /^[a-z]{3}(?:_[a-z]+)*(?:\+[a-z]{3}(?:_[a-z]+)*)*$/;
const LANGUAGE_MAX_LENGTH = 64;

function isEngineMode(value: unknown): value is EngineMode {
  return typeof value === 'string' && ENGINE_MODES.includes(value);
}

function isLanguage(value: unknown): value is string {
  return typeof value === 'string' && value.length <= LANGUAGE_MAX_LENGTH && LANGUAGE_PATTERN.test(value);
}

/** Keeps each valid field of `value`; anything missing or invalid takes its default. */
function sanitize(value: unknown): Prefs {
  const v = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  return {
    mode: isEngineMode(v.mode) ? v.mode : DEFAULT_PREFS.mode,
    language: isLanguage(v.language) ? v.language : DEFAULT_PREFS.language,
    reviewBeforeAnalysis:
      typeof v.reviewBeforeAnalysis === 'boolean' ? v.reviewBeforeAnalysis : DEFAULT_PREFS.reviewBeforeAnalysis,
  };
}

function parse(raw: string | null): Prefs {
  if (raw === null) return { ...DEFAULT_PREFS };
  try {
    return sanitize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
/** Holds this session's choice when localStorage can't be written (blocked or full). */
let unsaved: Prefs | null = null;
// The snapshot is re-parsed only when the stored string changes, so React sees a stable object.
let cachedRaw: string | null | undefined;
let cachedPrefs: Prefs = { ...DEFAULT_PREFS };

/** Current preferences. Returns the same object until they change. */
export function readPrefs(): Prefs {
  if (unsaved) return unsaved;
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedPrefs = parse(raw);
  }
  return cachedPrefs;
}

function writePrefs(next: Partial<Prefs>): void {
  const merged = sanitize({ ...readPrefs(), ...next });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    unsaved = null;
  } catch {
    unsaved = merged;
  }
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Keeps other tabs in step.
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

/** Reading preferences saved in this browser, and a setter that merges and persists changes. */
export function usePrefs(): [Prefs, (next: Partial<Prefs>) => void] {
  return [useSyncExternalStore(subscribe, readPrefs), writePrefs];
}
