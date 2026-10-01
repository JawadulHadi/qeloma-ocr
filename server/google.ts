import { createRemoteJWKSet, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import type { SessionUser } from '../shared/types.js';
import { HttpError } from './http.js';

const GOOGLE_CERTS_URL = new URL('https://www.googleapis.com/oauth2/v3/certs');
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

// One key set per process: jose caches Google's keys and refetches them when they rotate.
let googleKeys: JWTVerifyGetKey | null = null;

function signInFailed(cause?: unknown): HttpError {
  return new HttpError(401, 'unauthorized', 'Google sign-in failed. Try again.', { cause });
}

/** True for failures of the key fetch itself (network, timeout, bad key set) rather than of the token. */
function isKeyFetchFailure(err: unknown): boolean {
  return !(err instanceof errors.JOSEError) || err instanceof errors.JWKSTimeout || err instanceof errors.JWKSInvalid;
}

/**
 * Verifies a Google Identity Services ID token and returns the account it identifies.
 * `opts.keys` replaces Google's published keys (tests sign tokens with a local key pair).
 */
export async function verifyGoogleIdToken(
  credential: string,
  clientId: string,
  opts: { keys?: JWTVerifyGetKey } = {},
): Promise<SessionUser> {
  const keys = opts.keys ?? (googleKeys ??= createRemoteJWKSet(GOOGLE_CERTS_URL));

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(credential, keys, {
      issuer: GOOGLE_ISSUERS,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'exp'],
      clockTolerance: 5,
    }));
  } catch (err) {
    if (isKeyFetchFailure(err)) console.error("[api] Couldn't load Google's sign-in keys:", err);
    throw signInFailed(err);
  }

  const { sub, email, email_verified: emailVerified, name, picture } = payload;
  if (typeof sub !== 'string' || !sub || typeof email !== 'string' || !email || emailVerified !== true) {
    throw signInFailed();
  }
  return {
    id: sub,
    email,
    name: typeof name === 'string' && name.trim() ? name.trim() : email,
    picture: typeof picture === 'string' && picture.startsWith('https://') ? picture : null,
  };
}
