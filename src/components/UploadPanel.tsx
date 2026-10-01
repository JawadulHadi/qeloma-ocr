import { useEffect, useId } from 'react';
import { ClipboardType, Cloud, FileUp, HardDrive, TriangleAlert, X } from 'lucide-react';
import { MAX_SOURCES, MAX_UPLOAD_BYTES } from '../../shared/limits';
import type { ReadingItem } from '../hooks/useConversation';
import { OCR_LANGUAGES, SUPPORTED_GROUPS, type EngineMode } from '../lib/extract';
import { usePrefs } from '../lib/prefs';
import { isPersistent } from '../lib/store';
import { useFilePicker, type SourceActions } from './useFilePicker';
import { formatBytes } from './format';
import { Segmented } from './ui/Segmented';

const MODE_HELP: Record<EngineMode, string> = {
  auto: 'Reads on your device, and asks the AI to re-read only unclear images.',
  local: 'The file never leaves this browser. Best for clean prints.',
  ai: 'The AI reads images and scanned pages directly. Best for handwriting and messy scans.',
};

/** Without a sign-in nothing is sent to the AI, so Auto reads on the device only and AI vision is unavailable. */
const GUEST_MODE_HELP: Record<EngineMode, string> = {
  auto: 'Reads on your device. Sign in to let the AI re-read unclear images.',
  local: MODE_HELP.local,
  ai: 'AI vision needs you to sign in. Text-based PDFs and Office files are still read on your device.',
};

interface UploadPanelProps {
  /** Nobody has signed in: files are read on this device and history lasts only for this tab. */
  guest: boolean;
  actions: SourceActions;
  /** Files that couldn't be read, and why. */
  failures: ReadingItem[];
  onDismiss(id: string): void;
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

/** The empty workspace: a big drop zone, the other ways to add sources, and how to read them. */
export function UploadPanel({ guest, actions, failures, onDismiss }: UploadPanelProps) {
  const [prefs, setPrefs] = usePrefs();
  const picker = useFilePicker(actions.onFiles);
  const { onFiles } = actions;
  const modeHelpId = useId();
  const languageId = useId();
  const reviewId = useId();

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest('input, textarea, [contenteditable="true"], dialog')) return;
      const file = pastedImage(event);
      if (!file) return;
      event.preventDefault();
      onFiles([file]);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onFiles]);

  return (
    <div className="upload">
      {failures.length > 0 && (
        <div className="alert alert-danger upload-error" role="alert">
          <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
          <div className="alert-body">
            <p className="alert-title">{failures.length === 1 ? 'This file couldn’t be read.' : 'These files couldn’t be read.'}</p>
            <ul className="upload-failures">
              {failures.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.name}</strong> {item.error}
                  </span>
                  <button type="button" className="icon-btn" aria-label={`Dismiss ${item.name}`} onClick={() => onDismiss(item.id)}>
                    <X aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="btn btn-sm" onClick={picker.open}>
              Choose other files
            </button>
          </div>
        </div>
      )}

      <div className="dropzone panel" onClick={picker.open}>
        <span className="dropzone-lamp" aria-hidden="true" />
        <span className="dropzone-icon" aria-hidden="true">
          <FileUp size={28} />
        </span>
        <h1 className="dropzone-title">Drop documents to read them</h1>
        <p className="dropzone-sub">
          Photos, scans, PDFs, Office files and text, up to {formatBytes(MAX_UPLOAD_BYTES)} each. Add up to{' '}
          {MAX_SOURCES} at once, or a .zip of them. You can also paste an image.
        </p>
        <button type="button" className="btn btn-primary">
          Choose files
        </button>
        {picker.input}
      </div>

      <div className="upload-more" role="group" aria-label="Other ways to add sources">
        {actions.onDrive && (
          <button type="button" className="btn" onClick={actions.onDrive}>
            <HardDrive size={18} aria-hidden="true" />
            Google Drive
          </button>
        )}
        {actions.onOneDrive && (
          <button type="button" className="btn" onClick={actions.onOneDrive}>
            <Cloud size={18} aria-hidden="true" />
            OneDrive
          </button>
        )}
        <button type="button" className="btn" onClick={actions.onPaste}>
          <ClipboardType size={18} aria-hidden="true" />
          Paste text
        </button>
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
            {(guest ? GUEST_MODE_HELP : MODE_HELP)[prefs.mode]}
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

      {guest ? (
        <p className="upload-note">You’re not signed in, so documents are kept only until you close this tab.</p>
      ) : (
        !isPersistent() && <p className="upload-note">History isn’t saved in this browser window.</p>
      )}
    </div>
  );
}
