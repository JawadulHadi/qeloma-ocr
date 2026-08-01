import { useEffect, useState } from 'react';

type Mode = 'system' | 'light' | 'dark';
const KEY = 'ql-theme';

function apply(mode: Mode) {
  const el = document.documentElement;
  if (mode === 'system') {
    el.removeAttribute('data-theme');
    localStorage.removeItem(KEY);
  } else {
    el.setAttribute('data-theme', mode);
    localStorage.setItem(KEY, mode);
  }
}

export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(() => {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  });

  useEffect(() => { apply(mode); }, [mode]);

  const order: Mode[] = ['system', 'light', 'dark'];
  const labels: Record<Mode, string> = { system: 'Auto', light: 'Light', dark: 'Dark' };

  return (
    <div style={{ display: 'flex', gap: 4, background: 'var(--ql-panel-2)', padding: 4, borderRadius: 'var(--ql-radius-sm)', border: '1px solid var(--ql-border)' }}>
      {order.map((m) => (
        <button
          key={m}
          onClick={() => setMode(m)}
          style={{
            padding: '5px 10px', fontSize: 12, borderRadius: 6, border: 'none', cursor: 'pointer',
            background: mode === m ? 'var(--ql-accent)' : 'transparent',
            color: mode === m ? '#fff' : 'var(--ql-muted)', fontWeight: 600,
          }}
        >
          {labels[m]}
        </button>
      ))}
    </div>
  );
}
