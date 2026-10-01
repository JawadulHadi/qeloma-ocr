import type { GoogleAccountsId } from './gis';

const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client';
export const GIS_LOAD_ERROR =
  "Google sign-in couldn't load. Check your connection or disable blockers for accounts.google.com.";

let loading: Promise<GoogleAccountsId> | null = null;
let initializedClientId: string | null = null;
let credentialHandler: ((credential: string) => void) | null = null;

/** The Google Identity Services API if its script has already loaded. */
export function loadedGoogleIdentity(): GoogleAccountsId | null {
  return window.google?.accounts?.id ?? null;
}

/** Loads the Google Identity Services script once per page. A failed load can be retried. */
export function loadGoogleIdentity(): Promise<GoogleAccountsId> {
  const ready = loadedGoogleIdentity();
  if (ready) return Promise.resolve(ready);
  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      script.remove();
      loading = null;
      reject(new Error(GIS_LOAD_ERROR));
    };
    script.src = GIS_SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.addEventListener('load', () => {
      const id = loadedGoogleIdentity();
      if (id) resolve(id);
      else fail();
    });
    script.addEventListener('error', fail);
    document.head.append(script);
  });
  return loading;
}

/**
 * Configures Google Identity Services for `clientId` (once per client id). Credentials are routed to
 * whichever handler is registered at the time, so buttons can mount and unmount freely.
 */
export function initializeGoogleIdentity(id: GoogleAccountsId, clientId: string): void {
  if (initializedClientId === clientId) return;
  id.initialize({
    client_id: clientId,
    callback: ({ credential }) => credentialHandler?.(credential),
    ux_mode: 'popup',
    auto_select: false,
    itp_support: true,
    use_fedcm_for_prompt: true,
    cancel_on_tap_outside: true,
  });
  initializedClientId = clientId;
}

/** Makes `handler` receive the next Google credentials. Returns a function that unregisters it. */
export function setCredentialHandler(handler: (credential: string) => void): () => void {
  credentialHandler = handler;
  return () => {
    if (credentialHandler === handler) credentialHandler = null;
  };
}
