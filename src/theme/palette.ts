/**
 * Scanwise palette — the single source of truth for every theme color.
 * A theme is three independent choices: Mode × Accent × Surface (2 × 5 × 2 = 20 combinations).
 * themeCss.ts turns this file into CSS custom properties; palette.test.ts proves every text pair
 * reaches WCAG AA (4.5:1) in all 20 combinations, including glass panels over the catchlight glow.
 */
import { withAlpha } from './contrast';

export type Mode = 'dark' | 'light';
export type Accent = 'amber' | 'blue' | 'violet' | 'magenta' | 'graphite';
export type Surface = 'solid' | 'glass';

export interface ThemeChoice {
  mode: Mode;
  accent: Accent;
  surface: Surface;
}

export interface FeaturedTheme {
  id: string;
  name: string;
  blurb: string;
  choice: ThemeChoice;
}

export const MODES: readonly Mode[] = ['dark', 'light'];
export const ACCENTS: readonly Accent[] = ['amber', 'blue', 'violet', 'magenta', 'graphite'];
export const SURFACES: readonly Surface[] = ['solid', 'glass'];

export const MODE_LABELS: Record<Mode, string> = { dark: 'Dark', light: 'Light' };
export const ACCENT_LABELS: Record<Accent, string> = {
  amber: 'Amber',
  blue: 'Blue',
  violet: 'Violet',
  magenta: 'Magenta',
  graphite: 'Graphite',
};
export const SURFACE_LABELS: Record<Surface, string> = { solid: 'Solid', glass: 'Glass' };

/** Used when nothing is saved yet; the mode then follows the operating system. */
export const DEFAULT_ACCENT: Accent = 'amber';
export const DEFAULT_SURFACE: Surface = 'glass';

// ---- Base neutrals ------------------------------------------------------------

export interface BaseColors {
  bg: string;
  panel: string;
  panelRaised: string;
  panelSunken: string;
  border: string;
  /** Also outlines form fields, so it keeps 3:1 against panels. */
  borderStrong: string;
  text: string;
  textMuted: string;
  shadow: string;
  /** Modal backdrop. */
  scrim: string;
}

export const BASE: Record<Mode, BaseColors> = {
  dark: {
    bg: '#0D0F14',
    panel: '#151923',
    panelRaised: '#1B2030',
    panelSunken: '#10131A',
    border: '#2A3142',
    borderStrong: '#6B758C',
    text: '#E9ECF2',
    textMuted: '#A3ACBD',
    shadow: '0 1px 0 rgb(0 0 0 / 0.25), 0 18px 40px -12px rgb(0 0 0 / 0.6)',
    scrim: 'rgb(4 5 8 / 0.62)',
  },
  light: {
    bg: '#EEF0F4',
    panel: '#FFFFFF',
    panelRaised: '#FFFFFF',
    panelSunken: '#F5F6F9',
    border: '#D5DAE3',
    borderStrong: '#7D8697',
    text: '#151923',
    textMuted: '#525B6B',
    shadow: '0 1px 2px rgb(21 25 35 / 0.06), 0 18px 40px -16px rgb(21 25 35 / 0.24)',
    scrim: 'rgb(21 25 35 / 0.34)',
  },
};

// ---- Accents ------------------------------------------------------------------

export interface AccentColors {
  /** Fill for primary buttons, the scan bar, active indicators. */
  fill: string;
  /** The accent as text or icon color on panels. */
  ink: string;
  /** Text on `fill`. */
  onAccent: string;
  /** Subtle tinted background (selected rows, chips); `ink` stays readable on it. */
  soft: string;
  /** Color of the catchlight glow and the scan bar's light. */
  glow: string;
}

function accent(fill: string, ink: string, onAccent: string, glow: string, softAlpha: number): AccentColors {
  return { fill, ink, onAccent, soft: withAlpha(fill, softAlpha), glow };
}

/** Dark mode: the fill doubles as ink; text on the fill is dark. */
const DARK_SOFT = 0.12;
/** Light mode: separate fill and ink, because a fill bright enough to glow is too light to read as text. */
const LIGHT_SOFT = 0.12;

export const ACCENT_COLORS: Record<Mode, Record<Accent, AccentColors>> = {
  dark: {
    amber: accent('#F5B642', '#F5B642', '#1F1503', '#F5B642', DARK_SOFT),
    blue: accent('#6CA8FF', '#6CA8FF', '#07142B', '#6CA8FF', DARK_SOFT),
    violet: accent('#B39BFF', '#B39BFF', '#150B33', '#9C80FF', DARK_SOFT),
    magenta: accent('#F07AC8', '#F07AC8', '#2A0719', '#F07AC8', DARK_SOFT),
    graphite: accent('#C9CED8', '#C9CED8', '#111318', '#A9B4C8', DARK_SOFT),
  },
  light: {
    amber: accent('#E8A317', '#8A5300', '#1F1503', '#FFC857', LIGHT_SOFT),
    blue: accent('#2563EB', '#1D4FD7', '#FFFFFF', '#7DB2FF', LIGHT_SOFT),
    violet: accent('#6D4AE0', '#5B3BCB', '#FFFFFF', '#B9A2FF', LIGHT_SOFT),
    magenta: accent('#C0267F', '#A81F6E', '#FFFFFF', '#FF8CCF', LIGHT_SOFT),
    graphite: accent('#2E333D', '#2E333D', '#FFFFFF', '#A3ADBF', LIGHT_SOFT),
  },
};

// ---- Semantic colors (identical across accents and surfaces within a mode) ------

export interface SemanticColors {
  ok: string;
  warn: string;
  danger: string;
  okSoft: string;
  warnSoft: string;
  dangerSoft: string;
}

function semantic(ok: string, warn: string, danger: string, softAlpha: number): SemanticColors {
  return {
    ok,
    warn,
    danger,
    okSoft: withAlpha(ok, softAlpha),
    warnSoft: withAlpha(warn, softAlpha),
    dangerSoft: withAlpha(danger, softAlpha),
  };
}

export const SEMANTIC: Record<Mode, SemanticColors> = {
  dark: semantic('#5BD39A', '#F0C050', '#FF7A85', 0.12),
  light: semantic('#1B7148', '#855700', '#B42335', 0.1),
};

// ---- Glass surface ------------------------------------------------------------

/** One radial light. Positions and radii are percentages of the painted box. */
export interface GlowSpot {
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** Opacity of the glow color at the center — its peak. */
  alpha: number;
}

/** The glow falls to 40% of its peak at 40% of the radius and fades out completely here. */
export const GLOW_FALLOFF = { midStop: 0.4, midAlpha: 0.4, end: 0.72 } as const;

export interface GlassParams {
  /** Opacity of `panel` over the page. */
  panelAlpha: number;
  /** Opacity of `panelRaised` (menus, modals): high enough to stay readable over any content, even photos. */
  raisedAlpha: number;
  /** Opacity of `panelSunken` wells, which sit on panels. */
  sunkenAlpha: number;
  blurPx: number;
  saturatePct: number;
  /** The catchlight: a strong lamp top-left and a faint bounce bottom-right. */
  glow: { lamp: GlowSpot; bounce: GlowSpot };
  /** Inset top-edge highlight color on glass panels. */
  edge: string;
}

const LAMP = { x: 8, y: -8, rx: 75, ry: 60 };
const BOUNCE = { x: 100, y: 110, rx: 55, ry: 45 };

export const GLASS: Record<Mode, GlassParams> = {
  dark: {
    panelAlpha: 0.62,
    raisedAlpha: 0.95,
    sunkenAlpha: 0.55,
    blurPx: 20,
    saturatePct: 140,
    glow: { lamp: { ...LAMP, alpha: 0.22 }, bounce: { ...BOUNCE, alpha: 0.09 } },
    edge: 'rgb(255 255 255 / 0.06)',
  },
  light: {
    panelAlpha: 0.6,
    raisedAlpha: 0.94,
    sunkenAlpha: 0.6,
    blurPx: 20,
    saturatePct: 140,
    glow: { lamp: { ...LAMP, alpha: 0.22 }, bounce: { ...BOUNCE, alpha: 0.1 } },
    edge: 'rgb(255 255 255 / 0.7)',
  },
};

// ---- Featured themes ------------------------------------------------------------

export const FEATURED_THEMES: FeaturedTheme[] = [
  {
    id: 'lamplight',
    name: 'Lamplight',
    blurb: 'A reading lamp over a dark desk.',
    choice: { mode: 'dark', accent: 'amber', surface: 'glass' },
  },
  {
    id: 'cyanotype',
    name: 'Cyanotype',
    blurb: 'Blueprint blue on deep ink.',
    choice: { mode: 'dark', accent: 'blue', surface: 'solid' },
  },
  {
    id: 'blacklight',
    name: 'Blacklight',
    blurb: 'The UV glow that finds hidden watermarks.',
    choice: { mode: 'dark', accent: 'violet', surface: 'glass' },
  },
  {
    id: 'carbon',
    name: 'Carbon',
    blurb: 'Carbon-copy grays, nothing extra.',
    choice: { mode: 'dark', accent: 'graphite', surface: 'solid' },
  },
  {
    id: 'daylight',
    name: 'Daylight',
    blurb: 'Bright paper by a sunny window.',
    choice: { mode: 'light', accent: 'amber', surface: 'glass' },
  },
  {
    id: 'blue-pencil',
    name: 'Blue pencil',
    blurb: "An editor's blue marks on white.",
    choice: { mode: 'light', accent: 'blue', surface: 'solid' },
  },
  {
    id: 'proof',
    name: 'Proof',
    blurb: "A printer's proof with magenta notes.",
    choice: { mode: 'light', accent: 'magenta', surface: 'solid' },
  },
  {
    id: 'photocopy',
    name: 'Photocopy',
    blurb: 'Toner black on bright white.',
    choice: { mode: 'light', accent: 'graphite', surface: 'solid' },
  },
];

export function sameTheme(a: ThemeChoice, b: ThemeChoice): boolean {
  return a.mode === b.mode && a.accent === b.accent && a.surface === b.surface;
}

export function featuredThemeFor(choice: ThemeChoice): FeaturedTheme | undefined {
  return FEATURED_THEMES.find((theme) => sameTheme(theme.choice, choice));
}

/** "Lamplight" for a featured combination, otherwise e.g. "Light · Violet · Glass". */
export function themeName(choice: ThemeChoice): string {
  return (
    featuredThemeFor(choice)?.name ??
    `${MODE_LABELS[choice.mode]} · ${ACCENT_LABELS[choice.accent]} · ${SURFACE_LABELS[choice.surface]}`
  );
}

/** The spoken form for assistive tech, e.g. "Dark mode, amber accent, glass surface". */
export function describeTheme(choice: ThemeChoice): string {
  const accentLabel = ACCENT_LABELS[choice.accent].toLowerCase();
  const surfaceLabel = SURFACE_LABELS[choice.surface].toLowerCase();
  return `${MODE_LABELS[choice.mode]} mode, ${accentLabel} accent, ${surfaceLabel} surface`;
}

export function isMode(value: unknown): value is Mode {
  return MODES.includes(value as Mode);
}

export function isAccent(value: unknown): value is Accent {
  return ACCENTS.includes(value as Accent);
}

export function isSurface(value: unknown): value is Surface {
  return SURFACES.includes(value as Surface);
}

/** Every combination, mode-major, e.g. for the gallery and the contrast tests. */
export function allThemeChoices(): ThemeChoice[] {
  return MODES.flatMap((mode) =>
    ACCENTS.flatMap((accentName) => SURFACES.map((surface) => ({ mode, accent: accentName, surface }))),
  );
}
