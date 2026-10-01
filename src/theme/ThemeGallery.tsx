import { Check } from 'lucide-react';
import type { JSX } from 'react';
import { Modal } from '../components/ui/Modal';
import {
  ACCENTS,
  ACCENT_LABELS,
  MODE_LABELS,
  SURFACE_LABELS,
  describeTheme,
  featuredThemeFor,
  sameTheme,
  type Mode,
  type Surface,
  type ThemeChoice,
} from './palette';
import { useTheme } from './useTheme';

const COLUMNS: { mode: Mode; surface: Surface }[] = [
  { mode: 'dark', surface: 'solid' },
  { mode: 'dark', surface: 'glass' },
  { mode: 'light', surface: 'solid' },
  { mode: 'light', surface: 'glass' },
];

/** All 20 themes side by side: rows are accents, columns are mode × surface. Clicking one applies it. */
export function ThemeGallery({ open, onClose }: { open: boolean; onClose(): void }): JSX.Element {
  const { theme, setTheme } = useTheme();

  return (
    <Modal open={open} onClose={onClose} title="Look and feel" wide>
      <div className="gallery" role="group" aria-label="All themes">
        <span className="gallery-corner" aria-hidden="true" />
        {COLUMNS.map((column) => (
          <span key={`${column.mode}-${column.surface}`} className="gallery-col-head eyebrow" aria-hidden="true">
            {MODE_LABELS[column.mode]} · {SURFACE_LABELS[column.surface]}
          </span>
        ))}
        {ACCENTS.map((accent) => (
          <div key={accent} className="gallery-row" role="presentation">
            <span className="gallery-row-head eyebrow" aria-hidden="true">
              {ACCENT_LABELS[accent]}
            </span>
            {COLUMNS.map(({ mode, surface }) => {
              const choice: ThemeChoice = { mode, accent, surface };
              return (
                <GalleryCell
                  key={`${mode}-${surface}`}
                  choice={choice}
                  current={sameTheme(choice, theme)}
                  onPick={() => setTheme(choice)}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="gallery-note">
        Colors that mean something — confident, unsure, unreadable — look the same in every theme. If your system
        asks for reduced transparency, glass panels turn solid.
      </p>
    </Modal>
  );
}

function GalleryCell({ choice, current, onPick }: { choice: ThemeChoice; current: boolean; onPick(): void }) {
  const featured = featuredThemeFor(choice);
  const caption = `${ACCENT_LABELS[choice.accent]} · ${MODE_LABELS[choice.mode]} · ${SURFACE_LABELS[choice.surface]}`;
  return (
    <button
      type="button"
      className="gallery-cell"
      aria-pressed={current}
      aria-label={featured ? `${featured.name}: ${describeTheme(choice)}` : describeTheme(choice)}
      onClick={onPick}
    >
      <span
        className="theme-scope gallery-preview"
        data-mode={choice.mode}
        data-accent={choice.accent}
        data-surface={choice.surface}
        aria-hidden="true"
      >
        <span className="gallery-panel">
          <span className="gallery-title">Electricity bill</span>
          <span className="gallery-muted">Due 14 Oct · Rs 14,230</span>
          <span className="gallery-words">
            <span className="tone-ok">paid</span> <span className="tone-warn">late</span>{' '}
            <span className="tone-danger">fee</span>
          </span>
          <span className="gallery-button">Analyze</span>
        </span>
        {featured && <span className="gallery-badge">{featured.name}</span>}
      </span>
      <span className="gallery-caption" aria-hidden="true">
        {current && <Check size={14} />}
        {featured?.name ?? caption}
      </span>
    </button>
  );
}
