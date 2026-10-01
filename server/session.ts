import { jwtVerify, SignJWT } from 'jose';
import { SESSION_MAX_AGE_SECONDS } from '../shared/limits.js';
import type { SessionUser } from '../shared/types.js';
import { sessionSecret } from './env.js';
import { HttpError, isHttps } from './http.js';

export const SESSION_COOKIE = 'sw_session';

const ISSUER = 'scanwise';
const AUDIENCE = 'scanwise';

export async function createSessionToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ email: user.email, name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(user.id)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_MAX_AGE_SECONDS)
    .sign(sessionSecret());
}

/** The session's user, or null when the token is invalid, tampered with or expired. */
export async function verifySessionToken(token: string): Promise<SessionUser | null> {
  // Resolve the key outside the try: a missing secret is a server problem (503), not a bad token.
  const secret = sessionSecret();
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      requiredClaims: ['sub', 'exp', 'iat'],
    });
    const { sub, email, name, picture } = payload;
    if (typeof sub !== 'string' || !sub || typeof email !== 'string' || typeof name !== 'string') return null;
    return { id: sub, email, name, picture: typeof picture === 'string' ? picture : null };
  } catch {
    return null;
  }
}

function cookieAttributes(request: Request, maxAge: number): string {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (isHttps(request)) attributes.push('Secure');
  return attributes.join('; ');
}

export function sessionCookie(token: string, request: Request): string {
  return `${SESSION_COOKIE}=${token}; ${cookieAttributes(request, SESSION_MAX_AGE_SECONDS)}`;
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; ${cookieAttributes(request, 0)}`;
}

/** The raw session token from the Cookie header, if any. */
export function readSessionToken(request: Request): string | null {
  for (const pair of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = pair.slice(separator + 1).trim();
      return value ? value : null;
    }
  }
  return null;
}

export async function getSessionUser(request: Request): Promise<SessionUser | null> {
  const token = readSessionToken(request);
  return token ? verifySessionToken(token) : null;
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(request);
  if (user) return user;
  const message = readSessionToken(request) ? 'Your session expired. Sign in again.' : 'Sign in to continue.';
  throw new HttpError(401, 'unauthorized', message);
}
