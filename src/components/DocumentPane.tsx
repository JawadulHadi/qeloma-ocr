import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Pencil, Sparkles, TriangleAlert } from 'lucide-react';
import type { FileKind } from '../../shared/types';
import { MAX_ANALYZE_CHARS } from '../../shared/limits';
import type { ExtractedPage, ExtractionResult, ExtractProgress, FilePreview, PageMethod } from '../lib/extract';
import type { Phase } from '../hooks/useConversation';
import { ConfidenceText } from './ConfidenceText';
import { FileIcon } from './FileIcon';
import { Tabs } from './Tabs';
import { capitalize, confidenceTone, formatBytes, formatCount, formatPercent, pageNoun, plural } from './format';

/** What is known about the file: everything once it is read, only name and size while it is being read. */
export interface DocumentFile {
  name: string;
  size: number;
  kind?: FileKind;
  mimeType?: string;
  typeLabel?: string;
  pageCount?: number;
}

interface DocumentPaneProps {
  phase: Phase;
  file: DocumentFile | null;
  extraction: ExtractionResult | null;
  /** The text the AI analyzes: the extracted text, or the user's edit of it. */
  text: string;
  textEdited: boolean;
  preview: FilePreview | null;
  progress: ExtractProgress | null;
  /** Shown on narrow screens during review, where the Analysis tab is out of sight. */
  showAnalyzeAction: boolean;
  onCancel(): void;
  onSaveText(text: string): void;
  onAnalyze(): void;
}

type View = 'preview' | 'text';

const PREVIEW_PANEL = 'doc-preview';
const TEXT_PANEL = 'doc-text';

const METHOD_LABEL: Record<PageMethod, string> = {
  'text-layer': 'PDF text layer',
  ocr: 'On-device OCR',
  'ai-vision': 'AI vision',
  parsed: 'File text',
};

export function DocumentPane(props: DocumentPaneProps) {
  const { phase, file, extraction, preview, progress, onCancel } = props;
  const reading = phase === 'preparing' || phase === 'extracting';
  const [chosenView, setChosenView] = useState<View | null>(null);

  // While reading, the preview carries the scan bar; afterwards the text is what people came for.
  const view: View = preview ? (chosenView ?? (reading ? 'preview' : 'text')) : reading ? 'preview' : 'text';
  const tabbed = preview !== null;

  return (
    <div className="document">
      <div className="doc-head">
        <h2 className="pane-label">Document</h2>
        {file && <FileChip file={file} extraction={extraction} />}
        {tabbed && (
          <Tabs
            label="Document view"
            value={view}
            onChange={setChosenView}
            options={[
              { value: 'preview', label: 'Preview', panelId: PREVIEW_PANEL },
              { value: 'text', label: 'Text', panelId: TEXT_PANEL },
            ]}
          />
        )}
      </div>

      <div
        id={PREVIEW_PANEL}
        className="doc-view"
        role={tabbed ? 'tabpanel' : undefined}
        aria-labelledby={tabbed ? `${PREVIEW_PANEL}-tab` : undefined}
        hidden={view !== 'preview'}
      >
        <PreviewStage preview={preview} fileName={file?.name ?? 'the file'} reading={reading} />
        {reading && <ReadingStatus progress={progress} onCancel={onCancel} />}
        {!reading && preview && extraction && extraction.pages.length > 1 && (
          <p className="doc-caption">
            Showing the first {pageNoun(extraction.kind, extraction.mimeType)} of {extraction.pages.length}.
          </p>
        )}
      </div>

      <div
        id={TEXT_PANEL}
        className="doc-view"
        role={tabbed ? 'tabpanel' : undefined}
        aria-labelledby={tabbed ? `${TEXT_PANEL}-tab` : undefined}
        hidden={view !== 'text'}
      >
        {extraction ? (
          <TextView {...props} extraction={extraction} />
        ) : (
          <p className="doc-empty">The text appears here once reading finishes.</p>
        )}
      </div>
    </div>
  );
}

function FileChip({ file, extraction }: { file: DocumentFile; extraction: ExtractionResult | null }) {
  const kind = extraction?.kind ?? file.kind;
  const mimeType = extraction?.mimeType ?? file.mimeType ?? '';
  const pageCount = file.pageCount ?? extraction?.pages.length;
  const showPages = pageCount !== undefined && (pageCount > 1 || kind === 'pdf');
  const meta = [
    extraction?.typeLabel ?? file.typeLabel,
    formatBytes(file.size),
    showPages ? plural(pageCount, pageNoun(kind, mimeType)) : undefined,
    extraction?.engineLabel,
  ].filter(Boolean);

  return (
    <div className="file-chip">
      <span className="file-chip-icon">
        <FileIcon kind={kind} mimeType={mimeType} size={20} />
      </span>
      <div className="file-chip-body">
        <p className="file-chip-name" title={file.name}>
          {file.name}
        </p>
        <p className="file-chip-meta">{meta.join(' · ')}</p>
      </div>
      {extraction && extraction.meanConfidence !== null && (
        <span className={`badge badge-${confidenceTone(extraction.meanConfidence)}`} title="Average OCR confidence">
          {formatPercent(extraction.meanConfidence)} confident
        </span>
      )}
    </div>
  );
}

function PreviewStage({ preview, fileName, reading }: { preview: FilePreview | null; fileName: string; reading: boolean }) {
  return (
    <div className="preview-stage">
      <div className={reading ? 'preview-frame is-reading' : 'preview-frame'}>
        {preview ? (
          <img
            className="preview-image"
            src={preview.url}
            width={preview.width}
            height={preview.height}
            alt={`Preview of ${fileName}`}
          />
        ) : (
          <div className="paper-placeholder" aria-hidden="true">
            {Array.from({ length: 9 }, (_, index) => (
              <span key={index} className="paper-line" />
            ))}
          </div>
        )}
        {reading && (
          <div className="scan" aria-hidden="true">
            <div className="scan-beam" />
          </div>
        )}
      </div>
    </div>
  );
}

function ReadingStatus({ progress, onCancel }: { progress: ExtractProgress | null; onCancel(): void }) {
  const percent = Math.round((progress?.ratio ?? 0) * 100);
  return (
    <div className="reading-status">
      <div className="reading-status-text">
        <p className="reading-label" aria-live="polite">
          {progress?.label ?? 'Getting the file ready…'}
        </p>
        <div
          className="progress"
          role="progressbar"
          aria-label="Reading progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
        >
          <span className="progress-fill" style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

type CopyState = 'idle' | 'copied' | 'failed';

function TextView({
  phase,
  extraction,
  text,
  textEdited,
  showAnalyzeAction,
  onSaveText,
  onAnalyze,
}: DocumentPaneProps & { extraction: ExtractionResult }) {
  const [showConfidence, setShowConfidence] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  const canEdit = phase === 'review' || phase === 'ready' || phase === 'error';
  const hasText = text.trim().length > 0;
  const hasWordConfidence = !textEdited && extraction.pages.some((page) => page.lines && page.lines.length > 0);
  const multiPage = extraction.pages.length > 1;
  const noun = pageNoun(extraction.kind, extraction.mimeType);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 2400);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [editing]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const startEditing = () => {
    setDraft(text);
    setEditing(true);
  };

  const stopEditing = () => {
    returnFocus.current = true;
    setEditing(false);
  };

  const save = () => {
    onSaveText(draft);
    stopEditing();
  };

  if (editing) {
    const tooLong = draft.length > MAX_ANALYZE_CHARS;
    return (
      <div className="doc-edit">
        <label htmlFor="doc-edit-area" className="doc-edit-label">
          Edit the text to analyze
        </label>
        <textarea
          id="doc-edit-area"
          className="field doc-edit-area"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          dir="auto"
          spellCheck={false}
          autoFocus
          aria-describedby="doc-edit-count"
        />
        <p id="doc-edit-count" className={tooLong ? 'doc-edit-count is-over' : 'doc-edit-count'}>
          {plural(draft.length, 'character')}
          {tooLong && ` · only the first ${formatCount(MAX_ANALYZE_CHARS)} are analyzed`}
        </p>
        <div className="doc-edit-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={draft.trim().length === 0}>
            {phase === 'review' ? 'Save text' : 'Save and re-analyze'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={stopEditing}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="doc-text-view">
      <div className="doc-tools">
        {hasWordConfidence && (
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              checked={showConfidence}
              onChange={(event) => setShowConfidence(event.target.checked)}
            />
            <span className="switch-track" aria-hidden="true" />
            Show confidence
          </label>
        )}
        <div className="doc-tools-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copy()} disabled={!hasText}>
            {copyState === 'copied' ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            {copyState === 'copied' ? 'Copied' : 'Copy text'}
          </button>
          {canEdit && (
            <button ref={editButtonRef} type="button" className="btn btn-ghost btn-sm" onClick={startEditing}>
              <Pencil size={16} aria-hidden="true" />
              Edit text
            </button>
          )}
        </div>
      </div>
      <p className="visually-hidden" role="status">
        {copyState === 'copied' ? 'Text copied to the clipboard.' : ''}
      </p>
      {copyState === 'failed' && (
        <p className="doc-note is-danger" role="alert">
          This browser blocked copying. Select the text and copy it yourself.
        </p>
      )}

      {hasWordConfidence && showConfidence && (
        <ul className="legend" aria-label="Confidence colors">
          <li>
            <span className="legend-dot legend-ok" aria-hidden="true" />
            Confident
          </li>
          <li className="word-unsure">
            <span className="legend-dot legend-warn" aria-hidden="true" />
            Unsure
          </li>
          <li>
            <span className="legend-dot legend-danger" aria-hidden="true" />
            <span className="word-unclear">Hard to read</span>
          </li>
        </ul>
      )}

      {extraction.warnings.length > 0 && (
        <div className="alert alert-warn">
          <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
          <ul className="alert-list">
            {extraction.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {!hasText ? (
        <div className="doc-empty">
          <p className="doc-empty-title">No text was found in this file.</p>
          <p>For handwriting or blurry photos, start a new document with Reading set to AI vision.</p>
        </div>
      ) : textEdited ? (
        <>
          <p className="doc-note">You edited this text, so confidence colors are hidden.</p>
          <div className="doc-text">{text}</div>
        </>
      ) : (
        <div className="doc-pages">
          {extraction.pages.map((page) => (
            <div key={page.index} className="doc-page">
              {(multiPage || page.note) && <PageHeader page={page} noun={noun} numbered={multiPage} />}
              {page.lines && page.lines.length > 0 && showConfidence ? (
                <ConfidenceText lines={page.lines} />
              ) : page.text.trim() ? (
                <div className="doc-text">{page.text}</div>
              ) : (
                <p className="doc-page-empty">No text on this {noun}.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {showAnalyzeAction && (
        <div className="callout callout-accent doc-review">
          <p className="callout-title">Check the text, then analyze it.</p>
          <button type="button" className="btn btn-primary" onClick={onAnalyze} disabled={!hasText}>
            <Sparkles size={16} aria-hidden="true" />
            Analyze text
          </button>
        </div>
      )}
    </div>
  );
}

function PageHeader({ page, noun, numbered }: { page: ExtractedPage; noun: string; numbered: boolean }) {
  const parts = [
    numbered ? `${capitalize(noun)} ${page.index + 1}` : undefined,
    METHOD_LABEL[page.method],
    page.confidence !== null ? formatPercent(page.confidence) : undefined,
  ].filter(Boolean);
  return (
    <div className="doc-page-head">
      <p className="doc-page-meta">
        {parts.join(' · ')}
        {page.confidence !== null && (
          <span className={`doc-page-dot tone-${confidenceTone(page.confidence)}`} aria-hidden="true" />
        )}
      </p>
      {page.note && <p className="doc-page-note">{page.note}</p>}
    </div>
  );
}
