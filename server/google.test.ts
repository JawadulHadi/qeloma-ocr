import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { verifyGoogleIdToken } from './google.js';
import { TEST_CLIENT_ID } from './test-utils.js';

const KID = 'test-key';
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair('RS256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: KID, alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface TokenOptions {
  claims?: JWTPayload;
  issuer?: string;
  audience?: string;
  expiresAt?: number;
  key?: CryptoKey;
}

async function googleToken({
  claims = {},
  issuer = 'https://accounts.google.com',
  audience = TEST_CLIENT_ID,
  expiresAt = Math.floor(Date.now() / 1000) + 3600,
  key = privateKey,
}: TokenOptions = {}): Promise<string> {
  return new SignJWT({
    email: 'ada@example.com',
    email_verified: true,
    name: 'Ada Lovelace',
    picture: 'https://lh3.googleusercontent.com/a/ada',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setSubject('109876543210')
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(key);
}

const signInFailed = { status: 401, code: 'unauthorized', message: 'Google sign-in failed. Try again.' };

describe('verifyGoogleIdToken', () => {
  it('returns the Google account for a valid token', async () => {
    await expect(verifyGoogleIdToken(await googleToken(), TEST_CLIENT_ID, { keys })).resolves.toEqual({
      id: '109876543210',
      email: 'ada@example.com',
      name: 'Ada Lovelace',
      picture: 'https://lh3.googleusercontent.com/a/ada',
    });
  });

  it('accepts the issuer without a scheme', async () => {
    const token = await googleToken({ issuer: 'accounts.google.com' });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).resolves.toMatchObject({ id: '109876543210' });
  });

  it('falls back to the email for a missing name and drops a non-HTTPS picture', async () => {
    const token = await googleToken({ claims: { name: '  ', picture: 'http://example.com/a.png' } });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).resolves.toMatchObject({
      name: 'ada@example.com',
      picture: null,
    });
  });

  it('rejects a token issued for another app', async () => {
    const token = await googleToken({ audience: 'someone-else.apps.googleusercontent.com' });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects a token from another issuer', async () => {
    const token = await googleToken({ issuer: 'https://evil.example' });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects an unverified email', async () => {
    const token = await googleToken({ claims: { email_verified: false } });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects a token without an email', async () => {
    const token = await googleToken({ claims: { email: undefined } });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects an expired token', async () => {
    const token = await googleToken({ expiresAt: Math.floor(Date.now() / 1000) - 120 });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects a token signed with a key Google did not publish', async () => {
    const token = await googleToken({ key: otherPrivateKey });
    await expect(verifyGoogleIdToken(token, TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
  });

  it('rejects garbage without logging', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(verifyGoogleIdToken('a.b.c', TEST_CLIENT_ID, { keys })).rejects.toMatchObject(signInFailed);
    expect(log).not.toHaveBeenCalled();
  });

  it('logs when Google keys cannot be fetched, and still answers 401', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unreachable: JWTVerifyGetKey = async () => {
      throw new TypeError('fetch failed');
    };
    await expect(verifyGoogleIdToken(await googleToken(), TEST_CLIENT_ID, { keys: unreachable })).rejects.toMatchObject(
      signInFailed,
    );
    expect(log).toHaveBeenCalledTimes(1);
  });
});
