import { Check, Moon, Palette, Sun } from 'lucide-react';
import { useState, type JSX } from 'react';
import { Dropdown } from '../components/ui/Dropdown';
import { Segmented } from '../components/ui/Segmented';
import { tabbableIndex, useRovingRadios } from '../components/ui/useRovingRadios';
import {
  ACCENTS,
  ACCENT_LABELS,
  FEATURED_THEMES,
  MODE_LABELS,
  SURFACE_LABELS,
  sameTheme,
  type Accent,
  type Mode,
  type Surface,
  type ThemeChoice,
} from './palette';
import { ThemeGallery } from './ThemeGallery';
import { ThemeSwatch } from './ThemePreview';
import { useTheme } from './useTheme';

/** The header's theme picker: featured themes, a mix-your-own section and a door to the full gallery. */
export function AppearanceMenu({ compact = false }: { compact?: boolean }): JSX.Element {
  const { theme, themeName } = useTheme();
  const [galleryOpen, setGalleryOpen] = useState(false);

  return (
    <>
      <Dropdown
        label={`Appearance: ${themeName}`}
        triggerClassName="btn btn-ghost appearance-trigger"
        align="end"
        width={360}
        panelClassName="appearance-panel"
        trigger={
          <>
            <Palette size={18} aria-hidden="true" />
            {!compact && <span className="appearance-name">{themeName}</span>}
          </>
        }
      >
        {({ close }) => (
          <>
            <p className="appearance-intro">
              A theme is three choices that combine freely: mode, accent and surface.
            </p>
            <FeaturedThemes current={theme} />
            <MixYourOwn current={theme} />
            <footer className="appearance-foot">
              <span>Saved in this browser.</span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  close();
                  setGalleryOpen(true);
                }}
              >
                See all 20 side by side
              </button>
            </footer>
          </>
        )}
      </Dropdown>
      <ThemeGallery open={galleryOpen} onClose={() => setGalleryOpen(false)} />
    </>
  );
}

function FeaturedThemes({ current }: { current: ThemeChoice }) {
  const { setTheme } = useTheme();
  const checkedIndex = FEATURED_THEMES.findIndex((featured) => sameTheme(featured.choice, current));
  const { itemRef, onKeyDown } = useRovingRadios(FEATURED_THEMES.length, (index) =>
    setTheme(FEATURED_THEMES[index].choice),
  );
  const focusIndex = tabbableIndex(checkedIndex);

  return (
    <section className="appearance-section" aria-labelledby="appearance-featured">
      <h3 id="appearance-featured" className="eyebrow">
        Featured
      </h3>
      <div role="radiogroup" aria-labelledby="appearance-featured" className="featured-grid">
        {FEATURED_THEMES.map((featured, index) => {
          const checked = index === checkedIndex;
          return (
            <button
              key={featured.id}
              ref={itemRef(index)}
              type="button"
              role="radio"
              aria-checked={checked}
              tabIndex={index === focusIndex ? 0 : -1}
              className="featured-tile"
              onClick={() => setTheme(featured.choice)}
              onKeyDown={onKeyDown(index)}
            >
              <ThemeSwatch choice={featured.choice} />
              <span className="featured-text">
                <span className="featured-name">
                  {featured.name}
                  {checked && <Check size={14} aria-hidden="true" className="featured-check" />}
                </span>
                <span className="featured-blurb">{featured.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function MixYourOwn({ current }: { current: ThemeChoice }) {
  const { setTheme } = useTheme();
  const accentIndex = ACCENTS.indexOf(current.accent);
  const { itemRef, onKeyDown } = useRovingRadios(ACCENTS.length, (index) => setTheme({ accent: ACCENTS[index] }));

  return (
    <section className="appearance-section" aria-labelledby="appearance-mix">
      <h3 id="appearance-mix" className="eyebrow">
        Mix your own
      </h3>
      <div className="mix-row">
        <span className="mix-label">
          Mode
        </span>
        <Segmented<Mode>
          label="Mode"
          size="sm"
          value={current.mode}
          onChange={(mode) => setTheme({ mode })}
          options={[
            { value: 'dark', label: MODE_LABELS.dark, icon: <Moon size={14} aria-hidden="true" /> },
            { value: 'light', label: MODE_LABELS.light, icon: <Sun size={14} aria-hidden="true" /> },
          ]}
        />
      </div>
      <div className="mix-row">
        <span className="mix-label" id="appearance-accent">
          Accent
        </span>
        <div role="radiogroup" aria-labelledby="appearance-accent" className="accent-picker">
          {ACCENTS.map((accent: Accent, index) => (
            <button
              key={accent}
              ref={itemRef(index)}
              type="button"
              role="radio"
              aria-checked={index === accentIndex}
              aria-label={ACCENT_LABELS[accent]}
              title={ACCENT_LABELS[accent]}
              tabIndex={index === tabbableIndex(accentIndex) ? 0 : -1}
              className="accent-option"
              onClick={() => setTheme({ accent })}
              onKeyDown={onKeyDown(index)}
            >
              <span
                className="accent-dot"
                data-mode={current.mode}
                data-accent={accent}
                data-surface="solid"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      </div>
      <div className="mix-row">
        <span className="mix-label">Surface</span>
        <Segmented<Surface>
          label="Surface"
          size="sm"
          value={current.surface}
          onChange={(surface) => setTheme({ surface })}
          options={[
            { value: 'solid', label: SURFACE_LABELS.solid },
            { value: 'glass', label: SURFACE_LABELS.glass },
          ]}
        />
      </div>
    </section>
  );
}
