/**
 * A picker that couldn't finish. `message` is written for the reader; null means the person closed the picker
 * or the sign-in window themselves, which needs no message.
 */
export class PickerError extends Error {
  readonly silent: boolean;

  constructor(message: string | null) {
    super(message ?? '');
    this.name = 'PickerError';
    this.silent = message === null;
  }
}

/** The browser blocked the picker's window because it didn't open straight from a click. */
export class PopupBlockedError extends PickerError {
  constructor() {
    super('The browser blocked the picker window.');
    this.name = 'PopupBlockedError';
  }
}

const scripts = new Map<string, Promise<void>>();

/** Adds a script tag once per page. A failed load can be retried. */
export function loadScript(src: string): Promise<void> {
  let loading = scripts.get(src);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.addEventListener('load', () => resolve());
      script.addEventListener('error', () => {
        script.remove();
        scripts.delete(src);
        reject(new PickerError('A Google or Microsoft script couldn’t load. Check your connection or blockers and try again.'));
      });
      document.head.append(script);
    });
    scripts.set(src, loading);
  }
  return loading;
}
