import type { CSSProperties } from 'react';

type Tone = 'ok' | 'warn' | 'danger';

/** Lines of a sample bill; a word marked warn/danger is one the "OCR" was unsure of. */
const LINES: { words: [string, Tone?][]; className?: string }[] = [
  { words: [['City'], ['Power'], ['&'], ['Light']], className: 'specimen-org' },
  { words: [['Electricity'], ['bill'], ['·'], ['September'], ['2026']] },
  { words: [['Account'], ['no.'], ['04-2291-'], ['7735', 'warn']] },
  { words: [['Units'], ['used'], ['412'], ['kWh', 'danger']] },
  { words: [['Amount'], ['due'], ['Rs'], ['14,230']], className: 'specimen-strong' },
  { words: [['Due'], ['date'], ['14'], ['Oct'], ['2026']], className: 'specimen-strong' },
  { words: [['Late', 'warn'], ['payment'], ['fee'], ['Rs'], ['500'], ['after'], ['due'], ['date']] },
  { words: [['Instalment'], ['plans'], ['available'], ['on'], ['request.']] },
];

const rowStyle = (row: number) => ({ '--row': row }) as CSSProperties;

/**
 * The landing page's live demo: the lamp sweeps down a bill, words settle into their confidence colors,
 * then the insight appears. Decorative only; a static final frame under reduced motion.
 */
export function Specimen() {
  return (
    <div className="specimen" aria-hidden="true">
      <div className="specimen-doc panel">
        {LINES.map((line, row) => (
          <p key={row} className={line.className ? `specimen-line ${line.className}` : 'specimen-line'} style={rowStyle(row)}>
            {line.words.map(([word, tone], index) => (
              <span key={index} className={tone ? `specimen-word is-${tone}` : 'specimen-word'}>
                {word}{' '}
              </span>
            ))}
          </p>
        ))}
        <span className="specimen-lamp" />
      </div>
      <div className="specimen-insight panel-raised">
        <p className="specimen-insight-row">
          <span className="eyebrow">Key factor</span>
          <span>Due 14 Oct — late fee Rs 500 after this date</span>
        </p>
        <p className="specimen-insight-row">
          <span className="eyebrow">Solution</span>
          <span>Pay online before the 14th, or request an instalment plan (offered in the bill)</span>
        </p>
      </div>
    </div>
  );
}
