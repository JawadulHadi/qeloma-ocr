import { useId } from 'react';
import { ChevronRight, TriangleAlert, X } from 'lucide-react';
import type { ReadingItem } from '../hooks/useConversation';
import type { StoredSource } from '../lib/store';
import { AddSourcesMenu } from './AddSourcesMenu';
import type { SourceActions } from './useFilePicker';
import { FileIcon } from './FileIcon';
import { confidenceTone, formatPercent, pageNoun, plural } from './format';

interface SourcesPanelProps {
  sources: StoredSource[];
  reading: ReadingItem[];
  actions: SourceActions;
  onOpen(id: string): void;
  onToggle(id: string, included: boolean): void;
  onToggleAll(included: boolean): void;
  onCancelReading(id: string): void;
  onCancelAll(): void;
}

/** The left column: every source with a tick to include it, files being read, and the way to add more. */
export function SourcesPanel({
  sources,
  reading,
  actions,
  onOpen,
  onToggle,
  onToggleAll,
  onCancelReading,
  onCancelAll,
}: SourcesPanelProps) {
  const allId = useId();
  const includedCount = sources.filter((source) => source.included).length;
  const allIncluded = sources.length > 0 && includedCount === sources.length;
  const waiting = reading.filter((item) => item.status !== 'failed').length;

  return (
    <div className="sources">
      <div className="sources-head">
        <h2 className="pane-label">
          Sources <span className="section-count">{sources.length}</span>
        </h2>
        <AddSourcesMenu actions={actions} />
      </div>


      {sources.length > 1 && (
        <label className="source-all" htmlFor={allId}>
          <input
            id={allId}
            type="checkbox"
            className="checkbox"
            checked={allIncluded}
            ref={(input) => {
              if (input) input.indeterminate = includedCount > 0 && !allIncluded;
            }}
            onChange={(event) => onToggleAll(event.target.checked)}
          />
          Use all sources
          <span className="source-all-count">
            {includedCount} of {sources.length}
          </span>
        </label>
      )}

      {sources.length === 0 && waiting === 0 && (
        <p className="sources-empty">No sources yet. Add a file, a folder of files as a .zip, or some pasted text.</p>
      )}

      <ul className="source-list" aria-label="Sources">
        {sources.map((source) => (
          <SourceRow key={source.id} source={source} onOpen={onOpen} onToggle={onToggle} />
        ))}
        {reading.map((item) => (
          <ReadingRow key={item.id} item={item} onCancel={onCancelReading} />
        ))}
      </ul>

      {waiting > 1 && (
        <button type="button" className="btn btn-ghost btn-sm sources-cancel" onClick={onCancelAll}>
          Stop reading the {plural(waiting, 'remaining file')}
        </button>
      )}
    </div>
  );
}

function SourceRow({
  source,
  onOpen,
  onToggle,
}: {
  source: StoredSource;
  onOpen(id: string): void;
  onToggle(id: string, included: boolean): void;
}) {
  const { file, extraction } = source;
  const hasText = source.text.trim().length > 0;
  const meta = [
    file.typeLabel,
    file.pageCount > 1 ? plural(file.pageCount, pageNoun(file.kind, file.mimeType)) : undefined,
    hasText ? undefined : 'no text',
    source.textEdited ? 'edited' : undefined,
  ].filter(Boolean);

  return (
    <li className={source.included ? 'source-row' : 'source-row is-excluded'}>
      <input
        type="checkbox"
        className="checkbox"
        checked={source.included}
        aria-label={`Use ${source.label}, ${file.name}, in the summary and chat`}
        onChange={(event) => onToggle(source.id, event.target.checked)}
      />
      <button type="button" className="source-open" onClick={() => onOpen(source.id)}>
        <span className="source-icon">
          <FileIcon kind={file.kind} mimeType={file.mimeType} size={18} />
        </span>
        <span className="source-text">
          <span className="source-name">
            <span className="source-label">{source.label}</span>
            <span className="source-file" title={file.name}>
              {file.name}
            </span>
          </span>
          <span className="source-meta">
            {meta.join(' · ')}
            {extraction.meanConfidence !== null && (
              <span className={`source-confidence tone-${confidenceTone(extraction.meanConfidence)}`}>
                {formatPercent(extraction.meanConfidence)}
              </span>
            )}
          </span>
        </span>
        <ChevronRight size={16} aria-hidden="true" className="source-chevron" />
      </button>
    </li>
  );
}

function ReadingRow({ item, onCancel }: { item: ReadingItem; onCancel(id: string): void }) {
  const failed = item.status === 'failed';
  const percent = Math.round((item.progress?.ratio ?? 0) * 100);
  return (
    <li className={failed ? 'source-row is-reading is-failed' : 'source-row is-reading'}>
      <span className="source-icon" aria-hidden="true">
        {failed ? <TriangleAlert size={18} /> : <span className="lamp-dot" />}
      </span>
      <span className="source-text">
        <span className="source-name">
          <span className="source-file" title={item.name}>
            {item.name}
          </span>
        </span>
        {failed ? (
          <span className="source-error" role="alert">
            {item.error}
          </span>
        ) : (
          <>
            <span className="source-meta" aria-live="polite">
              {item.status === 'waiting' ? 'Waiting to be read' : (item.progress?.label ?? 'Reading…')}
            </span>
            <span
              className="progress"
              role="progressbar"
              aria-label={`Reading ${item.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span className="progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
            </span>
          </>
        )}
      </span>
      <button
        type="button"
        className="icon-btn"
        aria-label={failed ? `Dismiss ${item.name}` : `Stop reading ${item.name}`}
        onClick={() => onCancel(item.id)}
      >
        <X aria-hidden="true" />
      </button>
    </li>
  );
}
