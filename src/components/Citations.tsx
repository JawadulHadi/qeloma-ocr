import { useContext, type ReactNode } from 'react';
import { splitCitations } from '../../shared/citations';
import { CitationContext } from './citationContext';

/** A small "S1" chip that opens its source; greyed out when the source has since been removed. */
export function CitationChip({ label }: { label: string }) {
  const { sources, open } = useContext(CitationContext);
  const source = sources.find((candidate) => candidate.label === label);
  if (!source) {
    return (
      <span className="cite is-gone" title="This source was removed">
        {label}
      </span>
    );
  }
  return (
    <button
      type="button"
      className="cite"
      title={`Open ${source.file.name}`}
      aria-label={`Source ${label}: ${source.file.name}`}
      onClick={() => open(source.id)}
    >
      {label}
    </button>
  );
}

/** Plain text with its [S1] markers shown as chips. */
export function Cited({ text }: { text: string }): ReactNode {
  return splitCitations(text).map((segment, index) =>
    segment.type === 'text' ? (
      <span key={index}>{segment.text}</span>
    ) : (
      <span key={index} className="cite-group">
        {segment.labels.map((label) => (
          <CitationChip key={label} label={label} />
        ))}
      </span>
    ),
  );
}
