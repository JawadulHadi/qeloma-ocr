import type { OcrMode } from '../lib/ocr';

const MODES: { id: OcrMode; label: string; blurb: string }[] = [
  { id: 'local', label: 'Fast', blurb: 'In your browser. Private, offline, free.' },
  { id: 'ai', label: 'Smart', blurb: 'AI reads handwriting, tables, messy scans.' },
  { id: 'hybrid', label: 'Auto', blurb: 'Fast first, AI only if the scan is unclear.' },
];

export function ModePicker({ mode, onChange }: { mode: OcrMode; onChange: (m: OcrMode) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
      {MODES.map((m) => {
        const active = mode === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onChange(m.id)}
            style={{
              textAlign: 'left', padding: '12px 14px', cursor: 'pointer',
              borderRadius: 'var(--ql-radius-sm)',
              border: `1px solid ${active ? 'var(--ql-accent)' : 'var(--ql-border)'}`,
              background: active ? 'color-mix(in srgb, var(--ql-accent) 10%, var(--ql-panel))' : 'var(--ql-panel)',
              color: 'var(--ql-text)', transition: 'border-color .15s, background .15s',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 15, color: active ? 'var(--ql-accent)' : 'var(--ql-text)' }}>
              {m.label}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ql-muted)', marginTop: 4, lineHeight: 1.35 }}>
              {m.blurb}
            </div>
          </button>
        );
      })}
    </div>
  );
}
