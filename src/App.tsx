import { useState, useCallback, useRef } from 'react';
import { runOcr, disposeOcr, type OcrMode, type OcrResult } from './lib/ocr';
import { ModePicker } from './components/ModePicker';
import { DropZone } from './components/DropZone';
import { ResultPanel } from './components/ResultPanel';
import { ThemeToggle } from './components/ThemeToggle';

type Status = 'idle' | 'reading' | 'done' | 'error';

export default function App() {
  const [mode, setMode] = useState<OcrMode>('local');
  const [apiKey, setApiKey] = useState('');
  const [extractFields, setExtractFields] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<OcrResult | null>(null);
  const [error, setError] = useState('');
  const dropRef = useRef<HTMLDivElement>(null);

  const onFile = useCallback((f: File) => {
    setFile(f);
    setResult(null);
    setError('');
    setStatus('idle');
    setPreview(URL.createObjectURL(f));
  }, []);

  const read = useCallback(async () => {
    if (!file) return;
    setStatus('reading');
    setError('');
    try {
      const r = await runOcr(file, { mode, apiKey: apiKey || undefined, extractFields });
      setResult(r);
      setStatus('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong reading the image.');
      setStatus('error');
    }
  }, [file, mode, apiKey, extractFields]);

  const needsKey = mode === 'ai' || (mode === 'hybrid');

  return (
    <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '18px 24px', borderBottom: '1px solid var(--ql-border)',
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontFamily: 'var(--ql-font-head)', fontSize: 24, color: 'var(--ql-brand)', fontWeight: 700 }}>
            Qeloma
          </span>
          <span style={{ fontFamily: 'var(--ql-font-head)', fontSize: 24, color: 'var(--ql-accent)', fontWeight: 700 }}>
            OCR
          </span>
          <span style={{ color: 'var(--ql-muted)', fontSize: 13, marginLeft: 6 }}>
            read anything — and see how sure it is
          </span>
        </div>
        <ThemeToggle />
      </header>

      <main style={{
        flex: 1, display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)',
        gap: 24, padding: 24, maxWidth: 1200, width: '100%', margin: '0 auto',
      }} className="ocr-main">
        {/* Left: input */}
        <section style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ModePicker mode={mode} onChange={setMode} />

          {needsKey && (
            <div style={{
              background: 'var(--ql-panel)', border: '1px solid var(--ql-border)',
              borderRadius: 'var(--ql-radius-sm)', padding: 14,
            }}>
              <label style={{ fontSize: 13, color: 'var(--ql-muted)', display: 'block', marginBottom: 6 }}>
                Gemini API key {mode === 'hybrid' ? '(optional — only used if a scan is unclear)' : '(required for Smart mode)'}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="AIza…  (stays in your browser)"
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 'var(--ql-radius-sm)',
                  border: '1px solid var(--ql-border)', background: 'var(--ql-panel-2)',
                  color: 'var(--ql-text)', fontFamily: 'var(--ql-font-mono)', fontSize: 13,
                }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 13, color: 'var(--ql-muted)' }}>
                <input type="checkbox" checked={extractFields} onChange={(e) => setExtractFields(e.target.checked)} />
                Also extract structured fields (invoices, receipts, forms)
              </label>
            </div>
          )}

          <DropZone ref={dropRef} preview={preview} onFile={onFile} />

          <button
            onClick={read}
            disabled={!file || status === 'reading'}
            style={{
              padding: '12px 16px', borderRadius: 'var(--ql-radius-sm)', border: 'none',
              background: file ? 'var(--ql-accent)' : 'var(--ql-border)',
              color: '#fff', fontSize: 15, fontWeight: 600, cursor: file ? 'pointer' : 'not-allowed',
            }}
          >
            {status === 'reading' ? 'Reading…' : 'Read text'}
          </button>

          {error && (
            <div style={{
              background: 'color-mix(in srgb, var(--ql-danger) 12%, transparent)',
              border: '1px solid var(--ql-danger)', color: 'var(--ql-danger)',
              borderRadius: 'var(--ql-radius-sm)', padding: 12, fontSize: 14,
            }}>
              {error}
            </div>
          )}
        </section>

        {/* Right: output */}
        <section>
          <ResultPanel status={status} result={result} />
        </section>
      </main>

      <footer style={{ padding: '14px 24px', borderTop: '1px solid var(--ql-border)', color: 'var(--ql-muted)', fontSize: 12 }}>
        Fast mode runs entirely in your browser — private, offline, no cost. Smart mode uses your own Gemini key.
      </footer>
    </div>
  );
}

// clean up the tesseract worker when the tab closes
window.addEventListener('beforeunload', () => { void disposeOcr(); });
