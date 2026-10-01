import { useId, useState, type FormEvent } from 'react';
import { MAX_UPLOAD_BYTES } from '../../shared/limits';
import { Modal } from './ui/Modal';

/** Characters, not bytes: a rough cap that keeps pasted text inside the upload limit. */
const MAX_PASTE_CHARS = Math.floor(MAX_UPLOAD_BYTES / 4);

interface PasteTextModalProps {
  open: boolean;
  onClose(): void;
  onAdd(title: string, text: string): void;
}

/** Adds text from the clipboard (an email, a web page, a message) as a source. */
export function PasteTextModal({ open, onClose, onAdd }: PasteTextModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Paste text">
      {open && <PasteForm onClose={onClose} onAdd={onAdd} />}
    </Modal>
  );
}

function PasteForm({ onClose, onAdd }: Omit<PasteTextModalProps, 'open'>) {
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const titleId = useId();
  const textId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onAdd(title.trim() || 'Pasted text', text);
    onClose();
  };

  return (
    <form className="paste-form" onSubmit={submit}>
      <div className="option">
        <label className="option-label" htmlFor={titleId}>
          Name
        </label>
        <input
          id={titleId}
          className="field"
          value={title}
          placeholder="Pasted text"
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="option">
        <label className="option-label" htmlFor={textId}>
          Text
        </label>
        <textarea
          id={textId}
          className="field paste-area"
          value={text}
          maxLength={MAX_PASTE_CHARS}
          placeholder="Paste an email, a letter, a web page…"
          dir="auto"
          autoFocus
          onChange={(event) => setText(event.target.value)}
        />
      </div>
      <div className="paste-actions">
        <button type="submit" className="btn btn-primary" disabled={!text.trim()}>
          Add as a source
        </button>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
