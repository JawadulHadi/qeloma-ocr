import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type ReactNode } from 'react';
import { ThemeContext, type ThemeContextValue } from './context';
import { themeName, type ThemeChoice } from './palette';
import {
  applyDocumentTheme,
  defaultTheme,
  isThemeStorageEvent,
  parseSavedTheme,
  readDocumentTheme,
  readSavedTheme,
  systemModeQuery,
  writeSavedTheme,
} from './themeStore';

interface ThemeState {
  theme: ThemeChoice;
  /** True until the person picks a theme; the mode then tracks the operating system. */
  followsSystem: boolean;
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  // index.html's pre-paint script has already put the right theme on <html>; start from it.
  const [state, setState] = useState<ThemeState>(() => ({
    theme: readDocumentTheme(),
    followsSystem: readSavedTheme() === null,
  }));
  const themeRef = useRef(state.theme);

  useLayoutEffect(() => {
    themeRef.current = state.theme;
    applyDocumentTheme(state.theme);
  }, [state.theme]);

  useEffect(() => {
    const query = state.followsSystem ? systemModeQuery() : null;
    if (!query) return;
    const onChange = () =>
      setState((prev) =>
        prev.followsSystem ? { ...prev, theme: { ...prev.theme, mode: query.matches ? 'light' : 'dark' } } : prev,
      );
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [state.followsSystem]);

  // Another tab saved (or cleared) the theme: follow it so every open tab looks the same.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (!isThemeStorageEvent(event)) return;
      const saved = event.key === null ? null : parseSavedTheme(event.newValue);
      setState(saved ? { theme: saved, followsSystem: false } : { theme: defaultTheme(), followsSystem: true });
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setTheme = useCallback((next: Partial<ThemeChoice>) => {
    const current = themeRef.current;
    const theme: ThemeChoice = {
      mode: next.mode ?? current.mode,
      accent: next.accent ?? current.accent,
      surface: next.surface ?? current.surface,
    };
    themeRef.current = theme;
    writeSavedTheme(theme);
    setState({ theme, followsSystem: false });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme: state.theme, setTheme, themeName: themeName(state.theme) }),
    [state.theme, setTheme],
  );

  return <ThemeContext value={value}>{children}</ThemeContext>;
}
