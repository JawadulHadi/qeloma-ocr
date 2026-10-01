/**
 * Color math for the theme: parsing CSS colors, alpha compositing and WCAG 2.x contrast.
 * Channels are sRGB 0..255, alpha 0..1.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN = /^rgba?\((.*)\)$/i;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseHex(digits: string): Rgba {
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
  const channel = (i: number) => parseInt(full.slice(i * 2, i * 2 + 2), 16);
  return { r: channel(0), g: channel(1), b: channel(2), a: full.length === 8 ? channel(3) / 255 : 1 };
}

function parseChannel(token: string): number {
  const value = token.endsWith('%') ? (parseFloat(token) / 100) * 255 : parseFloat(token);
  return clamp(value, 0, 255);
}

function parseAlpha(token: string): number {
  const value = token.endsWith('%') ? parseFloat(token) / 100 : parseFloat(token);
  return clamp(value, 0, 1);
}

/** Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, and `rgb()`/`rgba()` in comma or space syntax. */
export function parseColor(input: string): Rgba {
  const text = input.trim();
  const hex = HEX.exec(text);
  if (hex) return parseHex(hex[1]);

  const fn = RGB_FN.exec(text);
  if (fn) {
    // rgb(r g b / a) | rgb(r, g, b) | rgba(r, g, b, a)
    const [channelText, slashAlpha, ...rest] = fn[1].split('/');
    const parts = channelText.split(/[\s,]+/).filter(Boolean);
    const alphaToken = slashAlpha === undefined ? parts[3] : slashAlpha.trim();
    const expected = slashAlpha === undefined ? [3, 4] : [3];
    if (rest.length === 0 && expected.includes(parts.length)) {
      const [r, g, b] = parts.slice(0, 3).map(parseChannel);
      const a = alphaToken === undefined ? 1 : parseAlpha(alphaToken);
      if (![r, g, b, a].some(Number.isNaN)) return { r, g, b, a };
    }
  }
  throw new Error(`Unsupported color: "${input}"`);
}

/** Space-separated "r g b" channels, the format of `--sw-glow-rgb`. */
export function rgbChannels(color: string): string {
  const { r, g, b } = parseColor(color);
  return `${Math.round(r)} ${Math.round(g)} ${Math.round(b)}`;
}

/** The same color at a different opacity, as modern `rgb(r g b / a)` syntax. */
export function withAlpha(color: string, alpha: number): string {
  return `rgb(${rgbChannels(color)} / ${alpha})`;
}

/** Source-over compositing of `top` onto `bottom`. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t: number, b: number) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/** Composites layers listed top-first onto an opaque base, e.g. `flatten(text, panel, pageBg)`. */
export function flatten(...layersTopFirst: (string | Rgba)[]): Rgba {
  const colors = layersTopFirst.map((c) => (typeof c === 'string' ? parseColor(c) : c));
  const base = colors[colors.length - 1];
  if (!base || base.a < 1) throw new Error('flatten() needs an opaque bottom layer.');
  return colors.slice(0, -1).reduceRight<Rgba>((below, layer) => composite(layer, below), base);
}

/**
 * The CSS `saturate(amount)` filter (Filter Effects spec matrix), applied to gamma-encoded sRGB
 * the way browsers apply filter functions. Used to model `backdrop-filter` in contrast tests.
 */
export function saturate(color: Rgba, amount: number): Rgba {
  const s = amount;
  const { r, g, b } = color;
  const channel = (value: number) => clamp(value, 0, 255);
  return {
    r: channel((0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b),
    g: channel((0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b),
    b: channel((0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b),
    a: color.a,
  };
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an opaque color. */
export function relativeLuminance(color: Rgba): number {
  if (color.a < 1) throw new Error('relativeLuminance() needs an opaque color; flatten() it first.');
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/**
 * WCAG 2.x contrast ratio (1..21). A translucent foreground is composited onto the background first;
 * the background must be opaque.
 */
export function contrastRatio(foreground: string | Rgba, background: string | Rgba): number {
  const bg = typeof background === 'string' ? parseColor(background) : background;
  const fgRaw = typeof foreground === 'string' ? parseColor(foreground) : foreground;
  const fg = fgRaw.a < 1 ? composite(fgRaw, bg) : fgRaw;
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export function toHex(color: Rgba): string {
  const part = (v: number) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}${color.a < 1 ? part(color.a * 255) : ''}`;
}
