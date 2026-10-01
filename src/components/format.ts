import type { FileKind } from '../../shared/types';

export type Tone = 'ok' | 'warn' | 'danger';

/** One scale for every confidence display: the file badge, page headers and word tints. */
export function confidenceTone(confidence: number): Tone {
  if (confidence >= 85) return 'ok';
  if (confidence >= 65) return 'warn';
  return 'danger';
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1).replace(/\.0$/, '') : Math.round(value)} ${units[unit]}`;
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US');
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`;
}

const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const diff = timestamp - now;
  const distance = Math.abs(diff);
  if (distance < MINUTE) return 'just now';
  if (distance < HOUR) return RELATIVE.format(Math.round(diff / MINUTE), 'minute');
  if (distance < DAY) return RELATIVE.format(Math.round(diff / HOUR), 'hour');
  if (distance < 7 * DAY) return RELATIVE.format(Math.round(diff / DAY), 'day');
  return DATE.format(timestamp);
}

/** What one "page" of a file is called, so a deck reads "Slide 3" rather than "Page 3". */
export function pageNoun(kind: FileKind | undefined, mimeType = ''): string {
  if (kind === 'office') {
    if (/presentation|powerpoint/i.test(mimeType)) return 'slide';
    if (/sheet|excel/i.test(mimeType)) return 'sheet';
  }
  return 'page';
}

export function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function initials(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 0 ? words.slice(0, 2).map((word) => word[0]) : [email.charAt(0)];
  return letters.join('').toUpperCase();
}
