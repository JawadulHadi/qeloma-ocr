import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { AuthConfig, SessionUser } from '../../shared/types';
import { errorMessage, getAuthConfig, getMe, onUnauthorized, signInWithGoogle, signOut as endSession } from '../lib/api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './context';
import { loadedGoogleIdentity } from './googleIdentity';

const SESSION_EXPIRED = 'Your session expired. Sign in again.';
const SESSION_CHECK_FAILED = "Can't reach Scanwise. Check your connection and reload the page.";
const SIGN_OUT_UNCONFIRMED =
  "You're signed out here, but Scanwise couldn't be reached to end the session. Reload and sign out again once you're online.";

interface AuthState {
  status: AuthStatus;
  user: SessionUser | null;
  config: AuthConfig | null;
  error: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading', user: null, config: null, error: null });

  useEffect(() => {
    let active = true;
    void Promise.allSettled([getAuthConfig(), getMe()]).then(([config, me]) => {
      if (!active) return;
      const user = me.status === 'fulfilled' ? me.value : null;
      setState({
        status: user ? 'signed-in' : 'signed-out',
        user,
        config: config.status === 'fulfilled' ? config.value : null,
        // When the config failed too, the sign-in button already explains that sign-in couldn't load.
        error:
          me.status === 'rejected' && config.status === 'fulfilled' ? errorMessage(me.reason, SESSION_CHECK_FAILED) : null,
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(
    () =>
      onUnauthorized(() =>
        setState((s) => (s.status === 'signed-in' ? { ...s, status: 'signed-out', user: null, error: SESSION_EXPIRED } : s)),
      ),
    [],
  );

  const signInWithCredential = useCallback(async (credential: string) => {
    setState((s) => ({ ...s, error: null }));
    const user = await signInWithGoogle(credential);
    setState((s) => ({ ...s, status: 'signed-in', user, error: null }));
  }, []);

  const signOut = useCallback(async () => {
    let error: string | null = null;
    try {
      await endSession();
    } catch {
      error = SIGN_OUT_UNCONFIRMED;
    }
    loadedGoogleIdentity()?.disableAutoSelect();
    setState((s) => ({ ...s, status: 'signed-out', user: null, error }));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ ...state, signInWithCredential, signOut }),
    [state, signInWithCredential, signOut],
  );

  return <AuthContext value={value}>{children}</AuthContext>;
}
