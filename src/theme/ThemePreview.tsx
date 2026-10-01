import type { JSX } from 'react';
import type { ThemeChoice } from './palette';

/**
 * A miniature of the app in one theme: page glow, a panel, an accent bar. The three data attributes scope
 * the theme's tokens to this element, so previews of every theme can sit side by side.
 */
export function ThemeSwatch({ choice }: { choice: ThemeChoice }): JSX.Element {
  return (
    <span
      className="theme-scope theme-swatch"
      data-mode={choice.mode}
      data-accent={choice.accent}
      data-surface={choice.surface}
      aria-hidden="true"
    >
      <span className="theme-swatch-panel">
        <span className="theme-swatch-line" />
        <span className="theme-swatch-line is-short" />
        <span className="theme-swatch-bar" />
      </span>
    </span>
  );
}
