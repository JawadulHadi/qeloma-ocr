import { useRef, type ChangeEvent } from 'react';
import { ACCEPT_ATTR } from '../lib/extract';

/** The ways a source can be added. Drive and OneDrive are present only when the server has them set up. */
export interface SourceActions {
  onFiles(files: File[]): void;
  onPaste(): void;
  onDrive?: () => void;
  onOneDrive?: () => void;
}

/** File types the picker offers: every readable type, plus ZIP archives of them. */
export const ACCEPT_WITH_ZIP = `${ACCEPT_ATTR},.zip,application/zip`;

/** A hidden multi-file input and a function that opens it. */
export function useFilePicker(onFiles: (files: File[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    // Reset so choosing the same files again still fires a change.
    event.target.value = '';
    if (files.length > 0) onFiles(files);
  };
  const input = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={ACCEPT_WITH_ZIP}
      className="visually-hidden"
      tabIndex={-1}
      aria-hidden="true"
      onChange={onChange}
      onClick={(event) => event.stopPropagation()}
    />
  );
  return { input, open: () => inputRef.current?.click() };
}

