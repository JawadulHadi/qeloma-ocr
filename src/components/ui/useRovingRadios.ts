import { useRef, type KeyboardEvent } from 'react';

/** Next index for radio-group keys (arrows wrap, Home/End jump), or null for any other key. */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Keyboard behavior of a WAI-ARIA radio group with a roving tabindex: only the checked radio is in the
 * tab order, and arrow keys move focus and selection together. The caller renders
 * `tabIndex={checked ? 0 : -1}` (or 0 on the first radio when none is checked).
 */
export function useRovingRadios(count: number, select: (index: number) => void) {
  const items = useRef<(HTMLElement | null)[]>([]);

  const itemRef = (index: number) => (element: HTMLElement | null) => {
    items.current[index] = element;
  };

  const onKeyDown = (index: number) => (event: KeyboardEvent<HTMLElement>) => {
    const next = nextRadioIndex(event.key, index, count);
    if (next === null) return;
    event.preventDefault();
    select(next);
    items.current[next]?.focus();
  };

  return { itemRef, onKeyDown };
}

/** Index that should be tabbable: the checked radio, else the first. */
export function tabbableIndex(checkedIndex: number): number {
  return checkedIndex >= 0 ? checkedIndex : 0;
}
