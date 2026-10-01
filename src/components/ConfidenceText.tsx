import { Fragment, memo } from 'react';
import type { OcrLine } from '../lib/extract';
import { confidenceTone, formatPercent, type Tone } from './format';

const WORD_CLASS: Record<Tone, string | undefined> = {
  ok: undefined,
  warn: 'word-unsure',
  danger: 'word-unclear',
};

/**
 * OCR text with every word tinted by how sure the engine was. Line breaks are kept, and each line picks its
 * own direction so mixed English/Urdu pages read correctly.
 */
export const ConfidenceText = memo(function ConfidenceText({ lines }: { lines: OcrLine[] }) {
  return (
    <div className="doc-text ocr-text">
      {lines.map((line, lineIndex) => (
        <div key={lineIndex} className="ocr-line" dir="auto">
          {line.words.map((word, wordIndex) => (
            <Fragment key={wordIndex}>
              {wordIndex > 0 && ' '}
              <span
                className={WORD_CLASS[confidenceTone(word.confidence)]}
                title={`${formatPercent(word.confidence)} confident`}
              >
                {word.text}
              </span>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
});
