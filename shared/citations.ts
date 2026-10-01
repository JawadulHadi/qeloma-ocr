/**
 * Source citations as the AI writes them: a label in square brackets after the sentence it supports, e.g. "[S1]",
 * or several at once, "[S1, S3]". Shared by the server (which drops labels that don't exist) and the browser
 * (which turns them into chips that open the source).
 */

const LABEL = 'S[1-9]\\d{0,3}';
const CITATION_SOURCE = `\\[(${LABEL}(?:\\s*[,;]\\s*${LABEL})*)\\]`;
const SEPARATOR = /\s*[,;]\s*/;

export type CitedSegment = { type: 'text'; text: string } | { type: 'cite'; labels: string[] };

/** Splits text into plain runs and citation brackets, in order. */
export function splitCitations(text: string): CitedSegment[] {
  const segments: CitedSegment[] = [];
  const pattern = new RegExp(CITATION_SOURCE, 'g');
  let last = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) segments.push({ type: 'text', text: text.slice(last, match.index) });
    segments.push({ type: 'cite', labels: match[1].split(SEPARATOR) });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
  return segments;
}

/** Removes citations of labels not in `known` (an AI can invent "[S9]"), with the space before a dropped one. */
export function stripUnknownCitations(text: string, known: ReadonlySet<string>): string {
  return text.replace(new RegExp(`(\\s?)${CITATION_SOURCE}`, 'g'), (_whole, space: string, inner: string) => {
    const kept = inner.split(SEPARATOR).filter((label) => known.has(label));
    return kept.length === 0 ? '' : `${space}[${kept.join(', ')}]`;
  });
}
