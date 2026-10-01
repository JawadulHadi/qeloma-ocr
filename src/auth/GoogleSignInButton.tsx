import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { errorMessage } from '../lib/api';
import type { GoogleAccountsId } from './gis';
import {
  initializeGoogleIdentity,
  loadGoogleIdentity,
  loadedGoogleIdentity,
  setCredentialHandler,
  GIS_LOAD_ERROR,
} from './googleIdentity';
import { useAuth } from './useAuth';

// /api/auth/config withholds the client id when either variable is missing in production, so name both.
const NOT_CONFIGURED = "Sign-in isn't set up on this server yet. It needs GOOGLE_CLIENT_ID and SESSION_SECRET.";
const CONFIG_UNAVAILABLE = "Sign-in couldn't load. Check your connection and reload the page.";
const SIGN_IN_FAILED = "Couldn't sign you in. Try again.";

/** Google's button widths are limited to this range. */
const MIN_WIDTH = 200;
const MAX_WIDTH = 400;

// Reserves the height of Google's large button so nothing shifts when it appears.
const slotStyle: CSSProperties = { minHeight: 44 };
const noteStyle: CSSProperties = { margin: '8px 0 0', fontSize: '0.875rem', color: 'var(--sw-text-muted)' };
const errorStyle: CSSProperties = { ...noteStyle, color: 'var(--sw-danger)' };

/**
 * Google's official "Continue with Google" button (popup flow) for the configured client id.
 * When sign-in isn't configured it explains that instead.
 */
export function GoogleSignInButton({ mode, width }: { mode: 'dark' | 'light'; width?: number }) {
  const { status, config, signInWithCredential } = useAuth();
  const clientId = config?.googleClientId ?? null;
  const slotRef = useRef<HTMLDivElement>(null);
  const [gis, setGis] = useState<GoogleAccountsId | null>(loadedGoogleIdentity);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId || gis) return;
    let active = true;
    loadGoogleIdentity().then(
      (id) => {
        if (active) setGis(id);
      },
      () => {
        if (active) setLoadError(GIS_LOAD_ERROR);
      },
    );
    return () => {
      active = false;
    };
  }, [clientId, gis]);

  useEffect(
    () =>
      setCredentialHandler(async (credential) => {
        setSigningIn(true);
        setSignInError(null);
        try {
          await signInWithCredential(credential);
        } catch (err) {
          setSignInError(errorMessage(err, SIGN_IN_FAILED));
        } finally {
          setSigningIn(false);
        }
      }),
    [signInWithCredential],
  );

  useEffect(() => {
    const slot = slotRef.current;
    if (!gis || !clientId || !slot) return;
    initializeGoogleIdentity(gis, clientId);
    slot.replaceChildren();
    gis.renderButton(slot, {
      type: 'standard',
      theme: mode === 'dark' ? 'filled_black' : 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      ...(width === undefined ? {} : { width: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(width))) }),
    });
  }, [gis, clientId, mode, width]);

  if (status === 'loading') return <div className="gsi-slot" style={slotStyle} aria-hidden="true" />;
  if (!config) return <p className="gsi-note" style={noteStyle}>{CONFIG_UNAVAILABLE}</p>;
  if (!clientId) return <p className="gsi-note" style={noteStyle}>{NOT_CONFIGURED}</p>;

  return (
    <div className="gsi">
      <div ref={slotRef} className="gsi-slot" style={slotStyle} />
      <div aria-live="polite">
        {signingIn && (
          <p className="gsi-note" style={noteStyle}>
            Signing you in…
          </p>
        )}
      </div>
      {(loadError ?? signInError) && (
        <p className="gsi-error" style={errorStyle} role="alert">
          {loadError ?? signInError}
        </p>
      )}
    </div>
  );
}
