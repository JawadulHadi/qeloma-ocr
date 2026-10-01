import { useEffect, useId, useRef, type ChangeEvent } from 'react';
import { FileUp, TriangleAlert } from 'lucide-react';
import { MAX_UPLOAD_BYTES } from '../../shared/limits';
import { ACCEPT_ATTR, OCR_LANGUAGES, SUPPORTED_GROUPS, type EngineMode } from '../lib/extract';
import { usePrefs } from '../lib/prefs';
import { isPersistent } from '../lib/store';
import { formatBytes } from './format';
import { Segmented } from './ui/Segmented';

const MODE_HELP: Record<EngineMode, string> = {
  auto: 'Reads on your device, and asks the AI to re-read only unclear images.',
  local: 'The file never leaves this browser. Best for clean prints.',
  ai: 'The AI reads images and scanned pages directly. Best for handwriting and messy scans.',
};

interface UploadPanelProps {
  onFile(file: File): void;
  /** Why the last file couldn't be read. */
  error: string | null;
}

/** First image file on the clipboard, named so it reads well in history. */
function pastedImage(event: ClipboardEvent): File | null {
  for (const item of event.clipboardData?.items ?? []) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    const ext = item.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
    return new File([blob], `Pasted image ${stamp}.${ext}`, { type: item.type });
  }
  return null;
}

/** The empty workspace: a big drop zone, the supported types, and how to read the file. */
export function UploadPanel({ onFile, error }: UploadPanelProps) {
  const [prefs, setPrefs] = usePrefs();
  const inputRef = useRef<HTMLInputElement>(null);
  const modeHelpId = useId();
  const languageId = useId();
  const reviewId = useId();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"]')) return;
      const file = pastedImage(event);
      if (!file) return;
      event.preventDefault();
      onFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFile]);

  const openPicker = () => inputRef.current?.click();

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires a change.
    event.target.value = '';
    if (file) onFile(file);
  };

  return (
    <div className="upload">
      {error && (
        <div className="alert alert-danger upload-error" role="alert">
          <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
          <div className="alert-body">
            <p className="alert-title">This file couldn’t be read.</p>
            <p>{error}</p>
            <button type="button" className="btn btn-sm" onClick={openPicker}>
              Choose another file
            </button>
          </div>
        </div>
      )}

      <div className="dropzone panel" onClick={openPicker}>
        <span className="dropzone-lamp" aria-hidden="true" />
        <span className="dropzone-icon" aria-hidden="true">
          <FileUp size={28} />
        </span>
        <h1 className="dropzone-title">Drop a document to read it</h1>
        <p className="dropzone-sub">
          Photos, scans, PDFs, Office files and text, up to {formatBytes(MAX_UPLOAD_BYTES)}. You can also paste an image.
        </p>
        <button type="button" className="btn btn-primary">
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTR}
          className="visually-hidden"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onChange}
          onClick={(event) => event.stopPropagation()}
        />
      </div>

      <dl className="supported" aria-label="Supported files">
        {SUPPORTED_GROUPS.map((group) => (
          <div key={group.label} className="supported-row">
            <dt className="eyebrow">{group.label}</dt>
            <dd className="supported-chips">
              {group.examples.map((example) => (
                <span key={example} className="chip">
                  {example}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>

      <div className="upload-options panel">
        <div className="option">
          <span className="option-label" id={`${modeHelpId}-label`}>
            Reading
          </span>
          <Segmented<EngineMode>
            label="Reading"
            value={prefs.mode}
            onChange={(mode) => setPrefs({ mode })}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'local', label: 'On-device' },
              { value: 'ai', label: 'AI vision' },
            ]}
          />
          <p className="option-help" id={modeHelpId} aria-live="polite">
            {MODE_HELP[prefs.mode]}
          </p>
        </div>

        <div className="option">
          <label className="option-label" htmlFor={languageId}>
            Language
          </label>
          <select
            id={languageId}
            className="field option-select"
            value={prefs.language}
            onChange={(event) => setPrefs({ language: event.target.value })}
          >
            {OCR_LANGUAGES.map((language) => (
              <option key={language.code} value={language.code}>
                {language.label}
              </option>
            ))}
          </select>
          <p className="option-help">The language printed in the document. Helps on-device reading.</p>
        </div>

        <div className="option option-check">
          <input
            id={reviewId}
            type="checkbox"
            className="checkbox"
            checked={prefs.reviewBeforeAnalysis}
            onChange={(event) => setPrefs({ reviewBeforeAnalysis: event.target.checked })}
          />
          <label htmlFor={reviewId}>
            <span className="option-label">Review text before analysis</span>
            <span className="option-help">Check and fix the text before anything is sent to the AI.</span>
          </label>
        </div>
      </div>

      {!isPersistent() && <p className="upload-note">History isn’t saved in this browser window.</p>}
    </div>
  );
}
