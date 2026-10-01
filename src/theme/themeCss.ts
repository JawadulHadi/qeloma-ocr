/**
 * Generates the theme's CSS custom properties from palette.ts.
 *
 * Rules are keyed on attributes, not on :root, so any element can scope a theme (the gallery previews
 * do). A scope must carry all three attributes — data-mode, data-accent and data-surface:
 *   [data-mode]                  neutrals + semantic colors
 *   [data-mode][data-accent]     accent tokens
 *   [data-mode][data-surface]    panels, backdrop blur and the catchlight glow
 */
import { rgbChannels, withAlpha } from './contrast';
import {
  ACCENT_COLORS,
  ACCENTS,
  BASE,
  GLASS,
  GLOW_FALLOFF,
  MODES,
  SEMANTIC,
  SURFACES,
  type Accent,
  type GlowSpot,
  type Mode,
  type Surface,
  type ThemeChoice,
} from './palette';

export type TokenMap = Record<`--sw-${string}`, string>;

const STYLE_ID = 'sw-theme';

const ROOT_TOKENS: TokenMap = {
  '--sw-font-display': '"Bricolage Grotesque Variable", "Segoe UI", system-ui, sans-serif',
  '--sw-font-body': '"Atkinson Hyperlegible Next Variable", "Segoe UI", system-ui, sans-serif',
  '--sw-font-mono':
    '"Atkinson Hyperlegible Mono Variable", ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace',
  '--sw-radius-lg': '16px',
  '--sw-radius': '12px',
  '--sw-radius-sm': '8px',
};

/** Neutrals and semantic colors: everything that depends on the mode alone. */
export function modeTokens(mode: Mode): TokenMap {
  const base = BASE[mode];
  const sem = SEMANTIC[mode];
  return {
    '--sw-bg': base.bg,
    '--sw-border': base.border,
    '--sw-border-strong': base.borderStrong,
    '--sw-text': base.text,
    '--sw-text-muted': base.textMuted,
    '--sw-ok': sem.ok,
    '--sw-warn': sem.warn,
    '--sw-danger': sem.danger,
    '--sw-ok-soft': sem.okSoft,
    '--sw-warn-soft': sem.warnSoft,
    '--sw-danger-soft': sem.dangerSoft,
    '--sw-shadow': base.shadow,
    '--sw-scrim': base.scrim,
  };
}

export function accentTokens(mode: Mode, accent: Accent): TokenMap {
  const colors = ACCENT_COLORS[mode][accent];
  return {
    '--sw-accent': colors.fill,
    '--sw-accent-ink': colors.ink,
    '--sw-on-accent': colors.onAccent,
    '--sw-accent-soft': colors.soft,
    '--sw-glow-rgb': rgbChannels(colors.glow),
    '--sw-focus': colors.ink,
  };
}

function solidPanels(mode: Mode): TokenMap {
  const base = BASE[mode];
  return {
    '--sw-panel': base.panel,
    '--sw-panel-raised': base.panelRaised,
    '--sw-panel-sunken': base.panelSunken,
    '--sw-backdrop': 'none',
  };
}

function glowLayer(spot: GlowSpot): string {
  const color = (alpha: number) => `rgb(var(--sw-glow-rgb) / ${+alpha.toFixed(3)})`;
  const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;
  const { midStop, midAlpha, end } = GLOW_FALLOFF;
  return (
    `radial-gradient(${spot.rx}% ${spot.ry}% at ${spot.x}% ${spot.y}%, ` +
    `${color(spot.alpha)}, ${color(spot.alpha * midAlpha)} ${pct(midStop)}, transparent ${pct(end)})`
  );
}

export function surfaceTokens(mode: Mode, surface: Surface): TokenMap {
  if (surface === 'solid') {
    return { ...solidPanels(mode), '--sw-bg-image': 'none', '--sw-edge': 'transparent' };
  }
  const base = BASE[mode];
  const glass = GLASS[mode];
  return {
    '--sw-panel': withAlpha(base.panel, glass.panelAlpha),
    '--sw-panel-raised': withAlpha(base.panelRaised, glass.raisedAlpha),
    '--sw-panel-sunken': withAlpha(base.panelSunken, glass.sunkenAlpha),
    '--sw-backdrop': `blur(${glass.blurPx}px) saturate(${glass.saturatePct}%)`,
    '--sw-bg-image': `${glowLayer(glass.glow.lamp)}, ${glowLayer(glass.glow.bounce)}`,
    '--sw-edge': glass.edge,
  };
}

/** Every token for one combination, exactly as the cascade resolves it on a fully scoped element. */
export function resolveTokens(choice: ThemeChoice): TokenMap {
  return {
    ...ROOT_TOKENS,
    ...modeTokens(choice.mode),
    ...accentTokens(choice.mode, choice.accent),
    ...surfaceTokens(choice.mode, choice.surface),
  };
}

function rule(selector: string, tokens: TokenMap, extra = ''): string {
  const body = Object.entries(tokens)
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n');
  return `${selector} {\n${extra}${body}\n}`;
}

const modeSel = (mode: Mode) => `[data-mode='${mode}']`;

export function buildThemeCss(): string {
  const blocks: string[] = [rule(':root', ROOT_TOKENS)];

  for (const mode of MODES) {
    blocks.push(rule(modeSel(mode), modeTokens(mode), `  color-scheme: ${mode};\n`));
    for (const accent of ACCENTS) {
      blocks.push(rule(`${modeSel(mode)}[data-accent='${accent}']`, accentTokens(mode, accent)));
    }
    for (const surface of SURFACES) {
      blocks.push(rule(`${modeSel(mode)}[data-surface='${surface}']`, surfaceTokens(mode, surface)));
    }
  }

  // Glass panels turn solid when the system asks for less transparency or can't blur the backdrop.
  // The glow stays: it is a background, not a see-through surface.
  const solidGlass = MODES.map((mode) => rule(`${modeSel(mode)}[data-surface='glass']`, solidPanels(mode)));
  const indent = (css: string) => css.replace(/^/gm, '  ');
  blocks.push(`@media (prefers-reduced-transparency: reduce) {\n${indent(solidGlass.join('\n'))}\n}`);
  blocks.push(
    `@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {\n${indent(solidGlass.join('\n'))}\n}`,
  );

  return `${blocks.join('\n\n')}\n`;
}

/** Injects the generated tokens as <style id="sw-theme">. Safe to call more than once. */
export function installThemeCss(doc: Document = document): void {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElement('style');
    style.id = STYLE_ID;
    doc.head.append(style);
  }
  const css = buildThemeCss();
  if (style.textContent !== css) style.textContent = css;
}
