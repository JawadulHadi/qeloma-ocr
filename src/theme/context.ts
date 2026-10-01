import { createContext } from 'react';
import type { ThemeChoice } from './palette';

export interface ThemeContextValue {
  theme: ThemeChoice;
  /** Applies and saves a theme; omitted fields keep their current value. */
  setTheme(next: Partial<ThemeChoice>): void;
  /** Featured name ("Lamplight") or the three choices ("Light · Violet · Glass"). */
  themeName: string;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);
