import { SignJWT, base64url, decodeJwt } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_MAX_AGE_SECONDS } from '../shared/limits.js';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSessionToken,
  getSessionUser,
  readSessionToken,
  requireUser,
  sessionCookie,
  verifySessionToken,
} from './session.js';
import { ORIGIN, TEST_SESSION_SECRET, sessionCookieHeader, stubServerEnv, testUser } from './test-utils.js';

beforeEach(() => {
  stubServerEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function withCookie(cookie: string): Request {
  return new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } });
}

describe('session tokens', () => {
  it('round-trips the user', async () => {
    const token = await createSessionToken(testUser);
    await expect(verifySessionToken(token)).resolves.toEqual(testUser);
  });

  it('round-trips a user without a picture', async () => {
    const user = { ...testUser, picture: null };
    await expect(verifySessionToken(await createSessionToken(user))).resolves.toEqual(user);
  });

  it('sets issuer, audience and a lifetime of SESSION_MAX_AGE_SECONDS', async () => {
    const claims = decodeJwt(await createSessionToken(testUser));
    expect(claims).toMatchObject({ iss: 'scanwise', aud: 'scanwise', sub: testUser.id });
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it('rejects a token whose payload was tampered with', async () => {
    const token = await createSessionToken(testUser);
    const [header, , signature] = token.split('.');
    const forged = base64url.encode(JSON.stringify({ ...decodeJwt(token), email: 'eve@example.com' }));
    await expect(verifySessionToken(`${header}.${forged}.${signature}`)).resolves.toBeNull();
  });

  it('rejects a token signed with another secret', async () => {
    const token = await createSessionToken(testUser);
    vi.stubEnv('SESSION_SECRET', 'a-completely-different-secret-of-sufficient-length');
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects a token for another issuer or audience', async () => {
    const secret = new TextEncoder().encode(TEST_SESSION_SECRET);
    const foreign = await new SignJWT({ email: testUser.email, name: testUser.name })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(testUser.id)
      .setIssuer('someone-else')
      .setAudience('scanwise')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);
    await expect(verifySessionToken(foreign)).resolves.toBeNull();
  });

  it('rejects an expired token', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const token = await createSessionToken(testUser);
    vi.setSystemTime(Date.now() + (SESSION_MAX_AGE_SECONDS + 1) * 1000);
    await expect(verifySessionToken(token)).resolves.toBeNull();
  });

  it('rejects garbage', async () => {
    await expect(verifySessionToken('not-a-jwt')).resolves.toBeNull();
  });

  it('needs a configured secret to create a session', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    await expect(createSessionToken(testUser)).rejects.toMatchObject({ status: 503, code: 'not_configured' });
  });
});

describe('session cookies', () => {
  it('is HttpOnly, SameSite=Lax, path-wide and lasts the session lifetime', () => {
    const cookie = sessionCookie('abc', new Request(`${ORIGIN}/api/auth/google`));
    expect(cookie).toBe(`${SESSION_COOKIE}=abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}`);
  });

  it('is Secure only over HTTPS', () => {
    expect(sessionCookie('abc', new Request('http://localhost:3000/'))).not.toContain('Secure');
    expect(sessionCookie('abc', new Request('https://scanwise.app/'))).toMatch(/; Secure$/);
    const proxied = new Request('http://10.0.0.1/', { headers: { 'X-Forwarded-Proto': 'https' } });
    expect(sessionCookie('abc', proxied)).toMatch(/; Secure$/);
  });

  it('clears with an empty value and Max-Age=0', () => {
    expect(clearSessionCookie(new Request('https://scanwise.app/'))).toBe(
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure`,
    );
  });

  it('finds the session among other cookies', () => {
    expect(readSessionToken(withCookie(`theme=dark; ${SESSION_COOKIE}=tok.en.value; other=1`))).toBe('tok.en.value');
    expect(readSessionToken(withCookie('theme=dark'))).toBeNull();
    expect(readSessionToken(withCookie(`${SESSION_COOKIE}=`))).toBeNull();
    expect(readSessionToken(new Request(ORIGIN))).toBeNull();
  });
});

describe('getSessionUser / requireUser', () => {
  it('returns the signed-in user', async () => {
    const request = withCookie(await sessionCookieHeader());
    await expect(getSessionUser(request)).resolves.toEqual(testUser);
    await expect(requireUser(request)).resolves.toEqual(testUser);
  });

  it('returns null without a session cookie', async () => {
    await expect(getSessionUser(new Request(ORIGIN))).resolves.toBeNull();
  });

  it('asks the user to sign in when there is no session', async () => {
    await expect(requireUser(new Request(ORIGIN))).rejects.toMatchObject({
      status: 401,
      code: 'unauthorized',
      message: 'Sign in to continue.',
    });
  });

  it('says the session expired when the cookie no longer verifies', async () => {
    await expect(requireUser(withCookie(`${SESSION_COOKIE}=stale.token.value`))).rejects.toMatchObject({
      status: 401,
      message: 'Your session expired. Sign in again.',
    });
  });
});
