import { useState } from 'react';
import type { OcrResult } from '../lib/ocr';

type Status = 'idle' | 'reading' | 'done' | 'error';

// Map a 0..100 confidence to a color from danger → warn → ok.
function confColor(c: number): string {
  if (c >= 85) return 'var(--ql-ok)';
  if (c >= 65) return 'var(--ql-warn)';
  return 'var(--ql-danger)';
}

export function ResultPanel({ status, result }: { status: Status; result: OcrResult | null }) {
  const [showConfidence, setShowConfidence] = useState(true);
  const [copied, setCopied] = useState(false);

  const panel = {
    background: 'var(--ql-panel)', border: '1px solid var(--ql-border)',
    borderRadius: 'var(--ql-radius)', padding: 20, minHeight: 300, height: '100%',
  } as const;

  if (status === 'idle') {
    return (
      <div style={{ ...panel, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ql-muted)' }}>
        The text you read will appear here — word by word, colored by confidence.
      </div>
    );
  }
  if (status === 'reading') {
    return (
      <div style={{ ...panel, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ql-muted)' }}>
        Reading the document…
      </div>
    );
  }
  if (!result) return <div style={panel} />;

  const copy = async () => {
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const hasWords = result.words.length > 0;

  return (
    <div style={panel}>
      {/* header: source + confidence summary */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase',
            color: 'var(--ql-accent)', fontFamily: 'var(--ql-font-mono)',
          }}>
            {result.source === 'local' ? 'read locally' : result.source === 'ai' ? 'read by AI' : 'local + AI'}
          </span>
          {result.meanConfidence > 0 && (
            <span style={{ fontSize: 13, color: confColor(result.meanConfidence), fontWeight: 600 }}>
              {result.meanConfidence}% confident
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {hasWords && (
            <button onClick={() => setShowConfidence((v) => !v)} style={ghostBtn}>
              {showConfidence ? 'Plain text' : 'Show confidence'}
            </button>
          )}
          <button onClick={copy} style={ghostBtn}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
      </div>

      {result.note && (
        <div style={{
          fontSize: 12, color: 'var(--ql-muted)', marginBottom: 12, padding: '8px 10px',
          background: 'var(--ql-panel-2)', borderRadius: 'var(--ql-radius-sm)',
          borderLeft: '3px solid var(--ql-accent)',
        }}>
          {result.note}
        </div>
      )}

      {/* the transcription */}
      <div style={{
        fontFamily: 'var(--ql-font-mono)', fontSize: 14, lineHeight: 1.7,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        maxHeight: 360, overflow: 'auto',
      }}>
        {showConfidence && hasWords
          ? result.words.map((w, i) => (
              <span
                key={i}
                title={`${w.confidence}% confident`}
                style={{
                  color: confColor(w.confidence),
                  borderBottom: w.confidence < 65 ? '2px dotted var(--ql-danger)' : 'none',
                  marginRight: 5,
                }}
              >
                {w.text}
              </span>
            ))
          : result.text || <span style={{ color: 'var(--ql-muted)' }}>No text found.</span>}
      </div>

      {/* structured fields (AI) */}
      {result.fields && Object.keys(result.fields).length > 0 && (
        <div style={{ marginTop: 18, borderTop: '1px solid var(--ql-border)', paddingTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, color: 'var(--ql-muted)', marginBottom: 10 }}>
            Extracted fields
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 14 }}>
            {Object.entries(result.fields).map(([k, v]) => (
              <div key={k} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--ql-muted)' }}>{k}</span>
                <span style={{ fontFamily: 'var(--ql-font-mono)' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const ghostBtn = {
  padding: '6px 10px', fontSize: 12, borderRadius: 'var(--ql-radius-sm)',
  border: '1px solid var(--ql-border)', background: 'var(--ql-panel-2)',
  color: 'var(--ql-text)', cursor: 'pointer',
} as const;
