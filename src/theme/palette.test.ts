import { describe, expect, it } from 'vitest';
import { contrastRatio, flatten, parseColor, saturate, toHex, withAlpha, type Rgba } from './contrast';
import {
  ACCENTS,
  FEATURED_THEMES,
  GLASS,
  GLOW_FALLOFF,
  MODES,
  SEMANTIC,
  SURFACES,
  allThemeChoices,
  themeName,
  type ThemeChoice,
} from './palette';
import { resolveTokens } from './themeCss';

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3;

interface Check {
  what: string;
  ratio: number;
  min: number;
}

interface Backdrop {
  name: string;
  color: Rgba;
}

/**
 * Opaque colors that can sit behind a panel. Glass panels are tested over the plain page AND over the
 * catchlight at its peak (the center of the strongest spot — the spots never overlap, see below),
 * after the backdrop-filter's saturate() has been applied.
 */
function backdrops(choice: ThemeChoice): Backdrop[] {
  const t = resolveTokens(choice);
  const bg = parseColor(t['--sw-bg']);
  if (choice.surface === 'solid') return [{ name: 'page', color: bg }];
  const { lamp, bounce } = GLASS[choice.mode].glow;
  const peak = Math.max(lamp.alpha, bounce.alpha);
  return [
    { name: 'page', color: bg },
    { name: 'page+glow', color: flatten(withAlpha(`rgb(${t['--sw-glow-rgb']})`, peak), bg) },
  ];
}

/** Every opaque color a token can be read against, labelled for failure messages. */
function surfaces(choice: ThemeChoice) {
  const t = resolveTokens(choice);
  const glass = choice.surface === 'glass';
  const saturation = GLASS[choice.mode].saturatePct / 100;
  const behindPanel = (b: Backdrop) => (glass ? saturate(b.color, saturation) : b.color);

  const page = backdrops(choice).map((b) => ({ name: b.name, color: b.color }));
  const panel = backdrops(choice).map((b) => ({
    name: `panel over ${b.name}`,
    color: flatten(t['--sw-panel'], behindPanel(b)),
  }));
  const raisedBackdrops: Backdrop[] = glass
    ? [...backdrops(choice), { name: 'black content', color: parseColor('#000000') }, { name: 'white content', color: parseColor('#FFFFFF') }]
    : backdrops(choice);
  const raised = raisedBackdrops.map((b) => ({
    name: `raised over ${b.name}`,
    color: flatten(t['--sw-panel-raised'], behindPanel(b)),
  }));
  const sunken = [
    ...panel.map((p) => ({ name: `sunken on ${p.name}`, color: flatten(t['--sw-panel-sunken'], p.color) })),
    ...page.map((p) => ({ name: `sunken on ${p.name}`, color: flatten(t['--sw-panel-sunken'], p.color) })),
  ];
  return { page, panel, raised, sunken };
}

function checksFor(choice: ThemeChoice): Check[] {
  const t = resolveTokens(choice);
  const { page, panel, raised, sunken } = surfaces(choice);
  const checks: Check[] = [];
  const check = (fgName: string, fg: string, bgName: string, bg: Rgba, min: number) =>
    checks.push({ what: `${fgName} on ${bgName} (${toHex(bg)})`, ratio: contrastRatio(fg, bg), min });

  const textTokens = ['--sw-text', '--sw-text-muted', '--sw-accent-ink', '--sw-ok', '--sw-warn', '--sw-danger'] as const;
  for (const surface of [...page, ...panel, ...raised, ...sunken]) {
    for (const token of textTokens) check(token, t[token], surface.name, surface.color, AA_TEXT);
  }

  check('--sw-on-accent', t['--sw-on-accent'], '--sw-accent', parseColor(t['--sw-accent']), AA_TEXT);

  for (const surface of [...panel, ...raised]) {
    const soft = flatten(t['--sw-accent-soft'], surface.color);
    check('--sw-accent-ink', t['--sw-accent-ink'], `accent-soft on ${surface.name}`, soft, AA_TEXT);
    for (const name of ['ok', 'warn', 'danger'] as const) {
      const tint = flatten(t[`--sw-${name}-soft`], surface.color);
      check(`--sw-${name}`, t[`--sw-${name}`], `${name}-soft on ${surface.name}`, tint, AA_TEXT);
    }
  }

  for (const surface of [...page, ...panel, ...raised]) {
    check('--sw-focus', t['--sw-focus'], surface.name, surface.color, AA_NON_TEXT);
  }
  for (const surface of panel) {
    check('--sw-border-strong', t['--sw-border-strong'], surface.name, surface.color, AA_NON_TEXT);
  }
  return checks;
}

const label = (c: ThemeChoice) => `${c.mode} · ${c.accent} · ${c.surface}`;

describe('palette contrast (WCAG 2.x)', () => {
  it.each(allThemeChoices().map((c) => [label(c), c] as const))('%s', (_name, choice) => {
    const failures = checksFor(choice)
      .filter((c) => c.ratio < c.min)
      .map((c) => `${c.what}: ${c.ratio.toFixed(2)} < ${c.min}`);
    expect(failures).toEqual([]);
  });

  it('covers all 20 combinations', () => {
    expect(allThemeChoices()).toHaveLength(MODES.length * ACCENTS.length * SURFACES.length);
    expect(allThemeChoices()).toHaveLength(20);
  });

  it.each(MODES)('keeps the lamp and the bounce apart in %s mode, so glow never stacks', (mode) => {
    const { lamp, bounce } = GLASS[mode].glow;
    const lampBottom = lamp.y + lamp.ry * GLOW_FALLOFF.end;
    const bounceTop = bounce.y - bounce.ry * GLOW_FALLOFF.end;
    expect(lampBottom).toBeLessThan(bounceTop);
  });
});

describe('semantic colors', () => {
  it.each(MODES)('are identical across accents and surfaces in %s mode', (mode) => {
    const names = ['--sw-ok', '--sw-warn', '--sw-danger', '--sw-ok-soft', '--sw-warn-soft', '--sw-danger-soft'] as const;
    const expected = Object.fromEntries(names.map((n) => [n, resolveTokens({ mode, accent: 'amber', surface: 'solid' })[n]]));
    for (const accent of ACCENTS) {
      for (const surface of SURFACES) {
        const tokens = resolveTokens({ mode, accent, surface });
        expect(Object.fromEntries(names.map((n) => [n, tokens[n]]))).toEqual(expected);
      }
    }
    expect(expected['--sw-ok']).toBe(SEMANTIC[mode].ok);
  });
});

describe('featured themes', () => {
  it('has 8 themes with unique ids, names and choices', () => {
    expect(FEATURED_THEMES).toHaveLength(8);
    expect(new Set(FEATURED_THEMES.map((t) => t.id)).size).toBe(8);
    expect(new Set(FEATURED_THEMES.map((t) => t.name)).size).toBe(8);
    expect(new Set(FEATURED_THEMES.map((t) => label(t.choice))).size).toBe(8);
    for (const theme of FEATURED_THEMES) expect(theme.blurb.length).toBeGreaterThan(0);
  });

  it('names the featured combinations from the spec', () => {
    expect(themeName({ mode: 'dark', accent: 'amber', surface: 'glass' })).toBe('Lamplight');
    expect(themeName({ mode: 'dark', accent: 'blue', surface: 'solid' })).toBe('Cyanotype');
    expect(themeName({ mode: 'dark', accent: 'violet', surface: 'glass' })).toBe('Blacklight');
    expect(themeName({ mode: 'dark', accent: 'graphite', surface: 'solid' })).toBe('Carbon');
    expect(themeName({ mode: 'light', accent: 'amber', surface: 'glass' })).toBe('Daylight');
    expect(themeName({ mode: 'light', accent: 'blue', surface: 'solid' })).toBe('Blue pencil');
    expect(themeName({ mode: 'light', accent: 'magenta', surface: 'solid' })).toBe('Proof');
    expect(themeName({ mode: 'light', accent: 'graphite', surface: 'solid' })).toBe('Photocopy');
  });

  it('describes other combinations by their three choices', () => {
    expect(themeName({ mode: 'light', accent: 'violet', surface: 'glass' })).toBe('Light · Violet · Glass');
    expect(themeName({ mode: 'dark', accent: 'amber', surface: 'solid' })).toBe('Dark · Amber · Solid');
  });
});
