import { useEffect, useRef, useState, type RefObject } from 'react';
import { ArrowLeft, Check, Copy, MessageSquareQuote, Pencil, Trash2, TriangleAlert } from 'lucide-react';
import { MAX_ANALYZE_CHARS, MAX_QUOTE_CHARS } from '../../shared/limits';
import { makePreview, type ExtractedPage, type FilePreview, type PageMethod } from '../lib/extract';
import type { StoredSource } from '../lib/store';
import { ConfidenceText } from './ConfidenceText';
import { FileIcon } from './FileIcon';
import { Tabs } from './Tabs';
import { capitalize, confidenceTone, formatBytes, formatCount, formatPercent, pageNoun, plural } from './format';

interface SourceViewerProps {
  source: StoredSource;
  /** Selected text can be quoted into the chat (signed in, with chat available). */
  canQuote: boolean;
  onBack(): void;
  onSaveText(text: string): void;
  onRemove(): void;
  onQuote(text: string): void;
}

type View = 'preview' | 'text';

const METHOD_LABEL: Record<PageMethod, string> = {
  'text-layer': 'PDF text layer',
  ocr: 'On-device OCR',
  'ai-vision': 'AI vision',
  parsed: 'File text',
};

const ORIGIN_LABEL: Record<StoredSource['origin'], string | null> = {
  upload: null,
  drive: 'From Google Drive',
  onedrive: 'From OneDrive',
  paste: 'Pasted text',
};

function extensionOf(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1].toLowerCase() ?? '';
}

/** A picture of the source's first page, made from the stored original; null when there's none to show. */
function useSourcePreview(source: StoredSource): FilePreview | null {
  const [preview, setPreview] = useState<{ id: string; value: FilePreview | null } | null>(null);
  const { blob, file, id } = source;

  useEffect(() => {
    if (!blob || file.kind === 'office' || file.kind === 'text') return;
    let active = true;
    let made: FilePreview | null = null;
    const original = blob instanceof File ? blob : new File([blob], file.name, { type: file.mimeType });
    void makePreview(original, { kind: file.kind, mimeType: file.mimeType, label: file.typeLabel, ext: extensionOf(file.name) })
      .catch(() => null)
      .then((value) => {
        made = value;
        if (active) setPreview({ id, value });
        else if (value) URL.revokeObjectURL(value.url);
      });
    return () => {
      active = false;
      if (made) URL.revokeObjectURL(made.url);
    };
  }, [blob, file, id]);

  return preview?.id === id ? preview.value : null;
}

/** One source, opened from the Sources list: its preview, its text (with confidence), and edits. */
export function SourceViewer(props: SourceViewerProps) {
  const { source, onBack, onRemove } = props;
  const preview = useSourcePreview(source);
  const [chosenView, setChosenView] = useState<View>('text');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const view: View = preview ? chosenView : 'text';
  const panelId = `source-${source.id}`;
  const origin = ORIGIN_LABEL[source.origin];

  return (
    <div className="viewer">
      <div className="viewer-head">
        <button type="button" className="btn btn-ghost btn-sm viewer-back" onClick={onBack}>
          <ArrowLeft size={16} aria-hidden="true" />
          All sources
        </button>
        {confirmingRemove ? (
          <div className="viewer-confirm" role="group" aria-label="Remove source">
            <span>Remove {source.label}?</span>
            <button type="button" className="btn btn-danger btn-sm" onClick={onRemove}>
              Remove
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingRemove(false)} autoFocus>
              Keep
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmingRemove(true)}>
            <Trash2 size={16} aria-hidden="true" />
            Remove
          </button>
        )}
      </div>

      <FileChip source={source} />
      {origin && <p className="viewer-origin">{origin}</p>}

      {preview && (
        <Tabs<View>
          label="Source view"
          value={view}
          onChange={setChosenView}
          options={[
            { value: 'preview', label: 'Preview', panelId: `${panelId}-preview` },
            { value: 'text', label: 'Text', panelId: `${panelId}-text` },
          ]}
        />
      )}

      {preview && (
        <div
          id={`${panelId}-preview`}
          className="doc-view"
          role="tabpanel"
          aria-labelledby={`${panelId}-preview-tab`}
          hidden={view !== 'preview'}
        >
          <div className="preview-stage">
            <div className="preview-frame">
              <img
                className="preview-image"
                src={preview.url}
                width={preview.width}
                height={preview.height}
                alt={`Preview of ${source.file.name}`}
              />
            </div>
          </div>
          {source.extraction.pages.length > 1 && (
            <p className="doc-caption">
              Showing the first {pageNoun(source.file.kind, source.file.mimeType)} of {source.extraction.pages.length}.
            </p>
          )}
        </div>
      )}

      <div
        id={`${panelId}-text`}
        className="doc-view"
        role={preview ? 'tabpanel' : undefined}
        aria-labelledby={preview ? `${panelId}-text-tab` : undefined}
        hidden={view !== 'text'}
      >
        <TextView key={source.id} {...props} />
      </div>
    </div>
  );
}

function FileChip({ source }: { source: StoredSource }) {
  const { file, extraction } = source;
  const showPages = file.pageCount > 1 || file.kind === 'pdf';
  const meta = [
    file.typeLabel,
    formatBytes(file.size),
    showPages ? plural(file.pageCount, pageNoun(file.kind, file.mimeType)) : undefined,
    extraction.engineLabel,
  ].filter(Boolean);

  return (
    <div className="file-chip">
      <span className="file-chip-icon">
        <FileIcon kind={file.kind} mimeType={file.mimeType} size={20} />
      </span>
      <div className="file-chip-body">
        <p className="file-chip-name" title={file.name}>
          <span className="source-label">{source.label}</span> {file.name}
        </p>
        <p className="file-chip-meta">{meta.join(' · ')}</p>
      </div>
      {extraction.meanConfidence !== null && (
        <span className={`badge badge-${confidenceTone(extraction.meanConfidence)}`} title="Average OCR confidence">
          {formatPercent(extraction.meanConfidence)} confident
        </span>
      )}
    </div>
  );
}

interface PendingQuote {
  text: string;
  top: number;
  left: number;
}

/** Where to float "Quote in chat": above the selected text, or below it when that would hide under the header. */
function quoteFromSelection(container: HTMLElement | null): PendingQuote | null {
  const selection = document.getSelection();
  if (!container || !selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const text = selection.toString().trim();
  if (!text) return null;
  const rect = range.getBoundingClientRect();
  const above = rect.top - 48;
  return {
    text: text.length > MAX_QUOTE_CHARS ? `${text.slice(0, MAX_QUOTE_CHARS).trimEnd()}…` : text,
    top: above < 72 ? rect.bottom + 8 : above,
    left: Math.min(Math.max(rect.left + rect.width / 2, 96), window.innerWidth - 96),
  };
}

/** Tracks a text selection inside `containerRef`, for the floating "Quote in chat" button. */
function useSelectionQuote(containerRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [pending, setPending] = useState<PendingQuote | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const onChange = () => setPending(quoteFromSelection(containerRef.current));
    document.addEventListener('selectionchange', onChange);
    // The button floats in the viewport, so it follows the text when a pane scrolls.
    window.addEventListener('scroll', onChange, true);
    window.addEventListener('resize', onChange);
    return () => {
      document.removeEventListener('selectionchange', onChange);
      window.removeEventListener('scroll', onChange, true);
      window.removeEventListener('resize', onChange);
    };
  }, [containerRef, enabled]);

  return enabled ? pending : null;
}

type CopyState = 'idle' | 'copied' | 'failed';

function TextView({ source, canQuote, onSaveText, onQuote }: SourceViewerProps) {
  const { extraction, text, textEdited, file } = source;
  const [showConfidence, setShowConfidence] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(false);
  const pendingQuote = useSelectionQuote(textRef, canQuote && !editing);

  const hasText = text.trim().length > 0;
  const hasWordConfidence = !textEdited && extraction.pages.some((page) => page.lines && page.lines.length > 0);
  const multiPage = extraction.pages.length > 1;
  const noun = pageNoun(file.kind, file.mimeType);

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

  const stopEditing = () => {
    returnFocus.current = true;
    setEditing(false);
  };

  const quote = () => {
    if (!pendingQuote) return;
    onQuote(pendingQuote.text);
    document.getSelection()?.removeAllRanges();
  };

  if (editing) {
    const tooLong = draft.length > MAX_ANALYZE_CHARS;
    return (
      <div className="doc-edit">
        <label htmlFor="doc-edit-area" className="doc-edit-label">
          Edit the text of {source.label}
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
          {tooLong && ` · at most ${formatCount(MAX_ANALYZE_CHARS)} are read by the AI`}
        </p>
        <div className="doc-edit-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSaveText(draft);
              stopEditing();
            }}
            disabled={draft.trim().length === 0}
          >
            Save text
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
          <button
            ref={editButtonRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setDraft(text);
              setEditing(true);
            }}
          >
            <Pencil size={16} aria-hidden="true" />
            Edit text
          </button>
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
      {canQuote && hasText && <p className="doc-hint">Select any passage to quote it in the chat.</p>}

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

      <div ref={textRef} id="doc-text" className="doc-text-body">
        {!hasText ? (
          <div className="doc-empty">
            <p className="doc-empty-title">No text was found in this file.</p>
            <p>For handwriting or blurry photos, add it again with Reading set to AI vision.</p>
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
      </div>

      {pendingQuote && (
        <button
          type="button"
          className="btn btn-primary btn-sm quote-float"
          style={{ top: pendingQuote.top, left: pendingQuote.left }}
          // Keeps the selection alive until the click lands.
          onPointerDown={(event) => event.preventDefault()}
          onClick={quote}
        >
          <MessageSquareQuote size={16} aria-hidden="true" />
          Quote in chat
        </button>
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
