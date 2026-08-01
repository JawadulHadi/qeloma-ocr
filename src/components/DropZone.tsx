import { forwardRef, useState, type DragEvent, useRef } from 'react';

interface Props {
  preview: string | null;
  onFile: (f: File) => void;
}

export const DropZone = forwardRef<HTMLDivElement, Props>(function DropZone(
  { preview, onFile },
  ref
) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && f.type.startsWith('image/')) onFile(f);
  };

  return (
    <div
      ref={ref}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
      style={{
        border: `2px dashed ${over ? 'var(--ql-accent)' : 'var(--ql-border)'}`,
        borderRadius: 'var(--ql-radius)', background: 'var(--ql-panel)',
        minHeight: 220, display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'pointer', overflow: 'hidden', position: 'relative', transition: 'border-color .15s',
      }}
    >
      {preview ? (
        <img src={preview} alt="Selected document" style={{ maxWidth: '100%', maxHeight: 340, display: 'block' }} />
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--ql-muted)', padding: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ql-text)' }}>Drop an image or PDF page</div>
          <div style={{ fontSize: 13, marginTop: 6 }}>or click to choose a file · PNG, JPG</div>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }}
      />
    </div>
  );
});
