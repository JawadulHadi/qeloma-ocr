import { createContext } from 'react';
import type { StoredSource } from '../lib/store';

interface CitationContextValue {
  sources: readonly StoredSource[];
  /** Opens the source a chip points at. */
  open(sourceId: string): void;
}

/** What citation chips need: the conversation's sources, and a way to open one. */
export const CitationContext = createContext<CitationContextValue>({ sources: [], open: () => undefined });
