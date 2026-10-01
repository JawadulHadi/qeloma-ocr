/** The Scanwise mark: a rounded page crossed by the scanner's lamp bar. */
export function ScanwiseMark() {
  return (
    <svg className="mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect className="mark-page" x="6" y="3" width="20" height="26" rx="4.5" />
      <rect className="mark-ink" x="10.5" y="8.5" width="11" height="2" rx="1" />
      <rect className="mark-ink" x="10.5" y="12.5" width="7.5" height="2" rx="1" />
      <rect className="mark-ink mark-ink-faint" x="10.5" y="23.5" width="9" height="2" rx="1" />
      <rect className="mark-glow" x="1" y="15.25" width="30" height="7" rx="3.5" />
      <rect className="mark-lamp" x="2.5" y="17" width="27" height="3.5" rx="1.75" />
    </svg>
  );
}

export function Wordmark({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? 'wordmark wordmark-lg' : 'wordmark'}>
      <ScanwiseMark />
      <span className="wordmark-text">Scanwise</span>
    </span>
  );
}
