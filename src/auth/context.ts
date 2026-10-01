import { createContext } from 'react';
import type { AuthConfig, SessionUser } from '../../shared/types';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

export interface AuthContextValue {
  status: AuthStatus;
  user: SessionUser | null;
  /** null until /api/auth/config loads, or if it failed. */
  config: AuthConfig | null;
  /** User-facing, e.g. "Your session expired. Sign in again." */
  error: string | null;
  /** Exchanges a Google ID token for a session. Rejects with an ApiError the caller can show. */
  signInWithCredential(credential: string): Promise<void>;
  signOut(): Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
