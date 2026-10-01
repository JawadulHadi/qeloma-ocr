import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_GEMINI_MODEL,
  geminiModel,
  requireGeminiApiKey,
  requireGoogleClientId,
  sessionSecret,
  signInClientId,
} from './env.js';
import { TEST_CLIENT_ID, TEST_SESSION_SECRET, stubServerEnv } from './test-utils.js';

const devStore = globalThis as typeof globalThis & { __scanwiseDevSessionSecret?: Uint8Array };

beforeEach(() => {
  stubServerEnv();
  delete devStore.__scanwiseDevSessionSecret;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('env', () => {
  it('reads configured values', () => {
    expect(requireGoogleClientId()).toBe(TEST_CLIENT_ID);
    expect(requireGeminiApiKey()).toBe('test-gemini-key');
    expect(new TextDecoder().decode(sessionSecret())).toBe(TEST_SESSION_SECRET);
  });

  it('defaults the Gemini model and honours an override', () => {
    expect(geminiModel()).toBe(DEFAULT_GEMINI_MODEL);
    vi.stubEnv('GEMINI_MODEL', 'gemini-custom');
    expect(geminiModel()).toBe('gemini-custom');
  });

  it('reports a missing Google client id as 503 with an end-user sentence', () => {
    vi.stubEnv('GOOGLE_CLIENT_ID', '  ');
    expect(() => requireGoogleClientId()).toThrow(
      expect.objectContaining({ status: 503, code: 'not_configured', message: "Sign-in isn't configured on this server yet." }),
    );
  });

  it('reports a missing Gemini key as 503', () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(() => requireGeminiApiKey()).toThrow(
      expect.objectContaining({ status: 503, message: "AI analysis isn't configured on this server yet." }),
    );
  });

  it('rejects a missing or short session secret outside local dev', () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect(() => sessionSecret()).toThrow(expect.objectContaining({ status: 503, code: 'not_configured' }));
    vi.stubEnv('SESSION_SECRET', 'x'.repeat(31));
    expect(() => sessionSecret()).toThrow(expect.objectContaining({ status: 503 }));
  });

  it('uses one ephemeral secret per process in local dev, warning once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('SESSION_SECRET', '');
    vi.stubEnv('SCANWISE_DEV', '1');
    const first = sessionSecret();
    const second = sessionSecret();
    expect(first.byteLength).toBeGreaterThanOrEqual(32);
    expect(second).toBe(first);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('still rejects a short secret in local dev', () => {
    vi.stubEnv('SCANWISE_DEV', '1');
    vi.stubEnv('SESSION_SECRET', 'short');
    expect(() => sessionSecret()).toThrow(expect.objectContaining({ status: 503 }));
  });

  it('only advertises the client id when sign-in can complete', () => {
    expect(signInClientId()).toBe(TEST_CLIENT_ID);
    vi.stubEnv('SESSION_SECRET', '');
    expect(signInClientId()).toBeNull();
    vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
    vi.stubEnv('GOOGLE_CLIENT_ID', '');
    expect(signInClientId()).toBeNull();
  });
});
