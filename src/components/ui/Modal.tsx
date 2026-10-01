import { X } from 'lucide-react';
import { useId, useLayoutEffect, useRef, type JSX, type PointerEvent, type MouseEvent, type ReactNode } from 'react';

export interface ModalProps {
  open: boolean;
  onClose(): void;
  title: string;
  /** Up to 1100px wide instead of 640px. */
  wide?: boolean;
  children: ReactNode;
}

/**
 * A modal dialog on the native <dialog> element: showModal() gives the top layer, inert background and
 * focus containment; the browser restores focus to the opener when it closes. Escape and a click on the
 * backdrop call onClose().
 */
export function Modal({ open, onClose, title, wide = false, children }: ModalProps): JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressStartedOnBackdrop = useRef(false);
  const titleId = useId();

  // Layout effect: the dialog must open or close in the same frame its content mounts or unmounts.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The frame fills the dialog box, so an event targeting the <dialog> itself hit its ::backdrop.
  // Both the press and the release must land there, so a text selection dragged outside doesn't close it.
  const onPointerDown = (event: PointerEvent<HTMLDialogElement>) => {
    pressStartedOnBackdrop.current = event.target === event.currentTarget;
  };
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose();
    pressStartedOnBackdrop.current = false;
  };

  return (
    <dialog
      ref={dialogRef}
      className={wide ? 'sw-modal sw-modal-wide' : 'sw-modal'}
      aria-labelledby={titleId}
      // Escape (or any close the browser does itself) lands here; a close we asked for has open === false.
      onClose={() => {
        if (open) onClose();
      }}
      onPointerDown={onPointerDown}
      onClick={onClick}
    >
      {open && (
        <div className="sw-modal-frame panel-raised">
          <header className="sw-modal-header">
            <h2 id={titleId} className="sw-modal-title">
              {title}
            </h2>
            <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
              <X />
            </button>
          </header>
          <div className="sw-modal-body">{children}</div>
        </div>
      )}
    </dialog>
  );
}
