import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type JSX,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

export interface DropdownProps {
  /** Accessible name of the trigger and of the panel. */
  label: string;
  /** Visible trigger content (icon, text, avatar). */
  trigger: ReactNode;
  triggerClassName?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  panelClassName?: string;
  /** Panel width; never wider than the viewport minus the 16px gutters. */
  width?: number | string;
  children: (api: { close(): void }) => ReactNode;
}

/** Below this viewport width the panel spans the screen between 16px gutters. */
const NARROW_VIEWPORT = 520;
const GUTTER = 16;
const GAP = 8;
const MIN_PANEL_HEIGHT = 160;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function firstFocusable(container: HTMLElement): HTMLElement | null {
  for (const element of container.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (element.tabIndex >= 0 && !element.closest('[hidden], [inert]')) return element;
  }
  return null;
}

/** Pixel offsets relative to the wrapper, measured after the panel's first layout. */
interface Placement {
  left: number;
  width: number | null;
  maxHeight: number;
}

/**
 * A non-modal popover anchored under its trigger button. Focus moves into the panel on open; Escape
 * closes it and returns focus to the trigger; clicking outside or tabbing out closes it.
 */
export function Dropdown({
  label,
  trigger,
  triggerClassName = 'btn btn-ghost',
  align = 'end',
  panelClassName,
  width,
  children,
}: DropdownProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const panelId = `${useId()}-panel`;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    setPlacement(null);
  }, []);

  /** Closes the panel; focus goes back to the trigger unless it already moved somewhere else. */
  const close = useCallback(() => {
    const active = document.activeElement;
    if (!active || active === document.body || rootRef.current?.contains(active)) triggerRef.current?.focus();
    dismiss();
  }, [dismiss]);

  // Measure once the panel has its natural layout, then keep it on screen. Runs before paint.
  useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!open || placement || !root || !panel) return;
    const viewportWidth = document.documentElement.clientWidth;
    const rootRect = root.getBoundingClientRect();
    const maxHeight = Math.max(MIN_PANEL_HEIGHT, window.innerHeight - rootRect.bottom - GAP - GUTTER);
    if (viewportWidth < NARROW_VIEWPORT) {
      setPlacement({ left: GUTTER - rootRect.left, width: viewportWidth - 2 * GUTTER, maxHeight });
      return;
    }
    const panelRect = panel.getBoundingClientRect();
    const onScreenLeft = Math.min(Math.max(panelRect.left, GUTTER), viewportWidth - GUTTER - panelRect.width);
    setPlacement({ left: onScreenLeft - rootRect.left, width: null, maxHeight });
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) (firstFocusable(panel) ?? panel).focus();

    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      dismiss();
    };
    // Re-measure from the natural layout whenever the viewport changes size.
    const onResize = () => setPlacement(null);
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, dismiss]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    // Keep an enclosing dialog open: this Escape belongs to the dropdown.
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  const onPanelBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !rootRef.current?.contains(next)) dismiss();
  };

  const style = {
    '--sw-dropdown-width': typeof width === 'number' ? `${width}px` : width,
    ...(placement && {
      left: `${placement.left}px`,
      right: 'auto',
      maxHeight: `${placement.maxHeight}px`,
      ...(placement.width !== null && { width: `${placement.width}px` }),
    }),
  } as CSSProperties;

  return (
    <div ref={rootRef} className="sw-dropdown" onKeyDown={onKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? dismiss() : setOpen(true))}
      >
        {trigger}
      </button>
      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          aria-label={label}
          tabIndex={-1}
          className={panelClassName ? `sw-dropdown-panel panel-raised ${panelClassName}` : 'sw-dropdown-panel panel-raised'}
          data-align={align}
          style={style}
          onBlur={onPanelBlur}
        >
          {children({ close })}
        </div>
      )}
    </div>
  );
}
