/**
 * Where the theme lives outside React: attributes on <html> (set before first paint by index.html)
 * and a JSON copy in localStorage. Storage can be blocked or full; the theme then lasts for the visit.
 */
import { DEFAULT_ACCENT, DEFAULT_SURFACE, isAccent, isMode, isSurface, type Mode, type ThemeChoice } from './palette';

/** Also read by the pre-paint script in index.html — keep the two in step. */
export const THEME_STORAGE_KEY = 'scanwise.theme';

const LIGHT_QUERY = '(prefers-color-scheme: light)';

export function parseSavedTheme(raw: string | null): ThemeChoice | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { mode, accent, surface } = value as Record<string, unknown>;
  return isMode(mode) && isAccent(accent) && isSurface(surface) ? { mode, accent, surface } : null;
}

export function readSavedTheme(): ThemeChoice | null {
  try {
    return parseSavedTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function writeSavedTheme({ mode, accent, surface }: ThemeChoice): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify({ mode, accent, surface }));
  } catch {
    // Blocked or full storage: the choice still applies until the tab closes.
  }
}

export function systemModeQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(LIGHT_QUERY) : null;
}

export function systemMode(): Mode {
  return systemModeQuery()?.matches ? 'light' : 'dark';
}

/** What a visitor sees before choosing anything. */
export function defaultTheme(): ThemeChoice {
  return { mode: systemMode(), accent: DEFAULT_ACCENT, surface: DEFAULT_SURFACE };
}

export function readDocumentTheme(root: HTMLElement = document.documentElement): ThemeChoice {
  const { mode, accent, surface } = root.dataset;
  const fallback = defaultTheme();
  return {
    mode: isMode(mode) ? mode : fallback.mode,
    accent: isAccent(accent) ? accent : fallback.accent,
    surface: isSurface(surface) ? surface : fallback.surface,
  };
}

export function applyDocumentTheme(choice: ThemeChoice, doc: Document = document): void {
  const root = doc.documentElement;
  root.dataset.mode = choice.mode;
  root.dataset.accent = choice.accent;
  root.dataset.surface = choice.surface;
  doc.querySelector('meta[name="color-scheme"]')?.setAttribute('content', choice.mode);
}

/** True for storage events that can change the saved theme (a write to our key, or localStorage.clear()). */
export function isThemeStorageEvent(event: StorageEvent): boolean {
  if (event.key !== null) return event.key === THEME_STORAGE_KEY;
  try {
    return event.storageArea === window.localStorage;
  } catch {
    return false;
  }
}
