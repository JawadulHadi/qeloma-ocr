import { MAX_ANALYZE_CHARS } from '../../shared/limits';
import type { Analysis, Importance } from '../../shared/types';
import type { Conversation, StoredMessage } from './store';

export interface MarkdownOptions {
  /** Include the (possibly edited) text that was analyzed. Default true. */
  includeExtractedText?: boolean;
  /** Timestamp printed in the export line. Default: now. */
  exportedAt?: Date;
}

// ---- Formatting (fixed English formats in local time, so output never depends on the browser locale) ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDateTime(d: Date): string {
  return `${formatDate(d)}, ${formatTime(d)}`;
}

function formatUtcOffset(d: Date): string {
  const minutes = -d.getTimezoneOffset();
  const abs = Math.abs(minutes);
  return `UTC${minutes < 0 ? '-' : '+'}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${Number(value.toFixed(1))} ${units[unit]}`;
}

const IMPORTANCE_LABELS: Record<Importance, string> = { high: 'High', medium: 'Medium', low: 'Low' };

// ---- Escaping --------------------------------------------------------------------

/** Collapses line breaks so the text fits in a heading, list item or table cell. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').trim();
}

/** Literal inline text (headings, link labels): Markdown punctuation is escaped so it shows as typed. */
function literal(text: string): string {
  return oneLine(text).replace(/[\\`*_[\]<>]/g, '\\$&');
}

function tableCell(text: string): string {
  return oneLine(text).replace(/\|/g, '\\|');
}

function table(header: string[], rows: string[][]): string {
  const line = (cells: string[]) => `| ${cells.map(tableCell).join(' | ')} |`;
  return [line(header), `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(line)].join('\n');
}

function bullets(items: string[]): string | null {
  const lines = items.map(oneLine).filter(Boolean);
  return lines.length ? lines.map((item) => `- ${item}`).join('\n') : null;
}

/** A fenced block whose backtick fence is longer than any backtick run inside `text`. */
function fenced(text: string, info: string): string {
  const longestRun = (text.match(/`+/g) ?? []).reduce((max, run) => Math.max(max, run.length), 0);
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}${info}\n${text}\n${fence}`;
}

// ---- Heading anchors (GitHub's rules: lower-case, punctuation dropped, spaces → "-", repeats get "-1", "-2"…) ----

function headingSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

class HeadingSlugger {
  private readonly seen = new Map<string, number>();

  slug(text: string): string {
    const base = headingSlug(text);
    let result = base;
    while (this.seen.has(result)) {
      const count = (this.seen.get(base) ?? 0) + 1;
      this.seen.set(base, count);
      result = `${base}-${count}`;
    }
    this.seen.set(result, 0);
    return result;
  }
}

/** Rendered text of every ATX heading in `markdown`, in order, skipping fenced code. */
function headingTexts(markdown: string): string[] {
  const headings: string[] = [];
  let fence: { char: string; length: number } | null = null;
  for (const line of markdown.split('\n')) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.length && !fenceMatch[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (fenceMatch) {
      fence = { char: fenceMatch[1][0], length: fenceMatch[1].length };
      continue;
    }
    const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (heading) headings.push((heading[1] ?? '').replace(/\\([!-/:-@[-`{-~])/g, '$1'));
  }
  return headings;
}

// ---- Conversation --------------------------------------------------------------------

interface RenderOptions {
  /** Heading level of the conversation title (1 alone, 2 inside a multi-conversation export). */
  level: number;
  /** Number prefixed to the title in a multi-conversation export. */
  number?: number;
  /** Line placed right under the title. */
  intro?: string;
  includeExtractedText: boolean;
}

function exportedLine(at: Date): string {
  return `Exported from Scanwise on ${formatDateTime(at)} (${formatUtcOffset(at)}).`;
}

function detailsTable(c: Conversation): string {
  const { meanConfidence, engineLabel } = c.extraction;
  const engine = meanConfidence === null ? engineLabel : `${engineLabel} (mean confidence ${Math.round(meanConfidence)}%)`;
  const rows = [
    ['File', c.file.name],
    ['Type', c.file.typeLabel],
    ['Size', formatBytes(c.file.size)],
    ['Pages', String(c.file.pageCount)],
    ['Extraction engine', engine],
    ...(c.model ? [['Model', c.model]] : []),
    ['Created', formatDateTime(new Date(c.createdAt))],
  ];
  return table(['Detail', 'Value'], rows);
}

function analysisSections(a: Analysis, h: (depth: number, text: string) => string): string[] {
  const out: string[] = [];
  const section = (title: string, body: string | null) => {
    if (body) out.push(h(1, title), body);
  };

  section('Summary', a.summary.trim() || null);
  section(
    'Key factors',
    a.keyFactors.length
      ? table(
          ['Factor', 'Importance', 'Detail'],
          a.keyFactors.map((f) => [f.label, IMPORTANCE_LABELS[f.importance], f.detail]),
        )
      : null,
  );
  section('Key points', bullets(a.keyPoints));
  if (a.solutions.length) {
    out.push(h(1, 'Solutions'));
    a.solutions.forEach((s, i) => {
      out.push(h(2, `${i + 1}. ${literal(s.title)}`));
      out.push(s.source === 'document' ? '_Offered in the document_' : '_Suggested_');
      if (s.description.trim()) out.push(s.description.trim());
      const steps = s.steps.map(oneLine).filter(Boolean);
      if (steps.length) out.push(steps.map((step, n) => `${n + 1}. ${step}`).join('\n'));
    });
  }
  section('Open questions', bullets(a.openQuestions));
  section('Caveats', bullets(a.caveats));
  return out;
}

function turn(m: StoredMessage, created: Date): string {
  const at = new Date(m.createdAt);
  const when = sameDay(at, created) ? formatTime(at) : formatDateTime(at);
  const parts = [`${m.role === 'user' ? '**You**' : '**Scanwise**'} — ${when}`, m.content.trimEnd()];
  if (m.error) parts.push(`_Not answered: ${oneLine(m.error)}_`);
  return parts.join('\n\n');
}

function readingNotes(c: Conversation): string | null {
  const notes = [
    ...c.extraction.warnings,
    ...c.extraction.pages.filter((p) => p.note).map((p) => `Page ${p.index + 1}: ${p.note}`),
  ]
    .map(oneLine)
    .filter(Boolean);
  return notes.length ? notes.map((note) => `> - ${note}`).join('\n') : null;
}

function renderConversation(c: Conversation, o: RenderOptions): string {
  const h = (depth: number, text: string) => `${'#'.repeat(o.level + depth)} ${text}`;
  const title = literal(c.title) || 'Untitled document';
  const blocks = [h(0, o.number === undefined ? title : `${o.number}. ${title}`)];
  if (o.intro) blocks.push(o.intro);
  blocks.push(detailsTable(c));
  if (c.analysisTruncated) {
    blocks.push(`_The text was long, so only its first ${formatCount(MAX_ANALYZE_CHARS)} characters were analyzed._`);
  }

  if (c.analysis) blocks.push(...analysisSections(c.analysis, h));

  if (c.messages.length) {
    const created = new Date(c.createdAt);
    blocks.push(h(1, 'Conversation'), ...c.messages.map((m) => turn(m, created)));
  }

  const text = c.text.replace(/\r\n?/g, '\n').replace(/\n+$/, '');
  if (o.includeExtractedText && text.trim()) {
    blocks.push(h(1, 'Extracted text'));
    if (c.textEdited) blocks.push('_Edited in Scanwise after extraction._');
    const notes = readingNotes(c);
    if (notes) blocks.push(notes);
    blocks.push(fenced(text, 'text'));
  }
  return blocks.join('\n\n');
}

/** One conversation as a standalone Markdown document. */
export function conversationToMarkdown(c: Conversation, opts: MarkdownOptions = {}): string {
  const exportedAt = opts.exportedAt ?? new Date();
  return `${renderConversation(c, {
    level: 1,
    intro: exportedLine(exportedAt),
    includeExtractedText: opts.includeExtractedText ?? true,
  })}\n`;
}

/** Several conversations in one document: a table of contents, then each conversation one heading level down. */
export function conversationsToMarkdown(cs: Conversation[], opts: MarkdownOptions = {}): string {
  const exportedAt = opts.exportedAt ?? new Date();
  const includeExtractedText = opts.includeExtractedText ?? true;
  const head = ['# Scanwise conversations', exportedLine(exportedAt)];
  if (!cs.length) return `${[...head, 'There are no conversations to export.'].join('\n\n')}\n`;

  const bodies = cs.map((c, i) => renderConversation(c, { level: 2, number: i + 1, includeExtractedText }));
  // Anchors must account for every earlier heading, since repeated headings get numbered suffixes.
  const slugger = new HeadingSlugger();
  slugger.slug('Scanwise conversations');
  slugger.slug('Contents');
  const anchors = bodies.map((body) => {
    const [title, ...rest] = headingTexts(body);
    const anchor = slugger.slug(title);
    rest.forEach((heading) => slugger.slug(heading));
    return anchor;
  });

  const contents = cs
    .map((c, i) => {
      const label = literal(c.title) || 'Untitled document';
      return `${i + 1}. [${label}](#${anchors[i]}) — ${literal(c.file.name)}, ${formatDate(new Date(c.createdAt))}`;
    })
    .join('\n');

  return `${[...head, '## Contents', contents, ...bodies.flatMap((body) => ['---', body])].join('\n\n')}\n`;
}

const FILENAME_SLUG_MAX = 60;

function filenameSlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  // Count code points, not UTF-16 units, so a character is never cut in half.
  return Array.from(slug).slice(0, FILENAME_SLUG_MAX).join('').replace(/-+$/, '');
}

/** e.g. "scanwise-electricity-bill-2026-10-01.md"; `null` names an export of all conversations. */
export function markdownFilename(c: Conversation | null, date: Date = new Date()): string {
  const name = c ? filenameSlug(c.title) || 'document' : 'conversations';
  return `scanwise-${name}-${isoDate(date)}.md`;
}
