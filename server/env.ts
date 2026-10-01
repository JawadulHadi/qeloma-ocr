import { randomBytes } from 'node:crypto';
import { HttpError } from './http.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const MIN_SESSION_SECRET_LENGTH = 32;

const SIGN_IN_NOT_CONFIGURED = "Sign-in isn't configured on this server yet.";
const AI_NOT_CONFIGURED = "AI analysis isn't configured on this server yet.";

/** Env values are read on every call so a redeploy or test stub never sees stale config. */
function read(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function notConfigured(message: string, detail: string): HttpError {
  return new HttpError(503, 'not_configured', message, { cause: detail });
}

/** Set by the Vite dev plugin; never set in production. */
function isLocalDev(): boolean {
  return process.env.SCANWISE_DEV === '1';
}

export function googleClientId(): string | null {
  return read('GOOGLE_CLIENT_ID');
}

export function requireGoogleClientId(): string {
  const id = googleClientId();
  if (!id) throw notConfigured(SIGN_IN_NOT_CONFIGURED, 'GOOGLE_CLIENT_ID is not set.');
  return id;
}

export function geminiApiKey(): string | null {
  return read('GEMINI_API_KEY');
}

export function requireGeminiApiKey(): string {
  const key = geminiApiKey();
  if (!key) throw notConfigured(AI_NOT_CONFIGURED, 'GEMINI_API_KEY is not set.');
  return key;
}

export function geminiModel(): string {
  return read('GEMINI_MODEL') ?? DEFAULT_GEMINI_MODEL;
}

/** Google Drive picker: a browser API key and the Cloud project number. Both public; null unless both are set. */
export function driveConfig(): { apiKey: string; appId: string } | null {
  const apiKey = read('GOOGLE_API_KEY');
  const appId = read('GOOGLE_APP_ID');
  return apiKey && appId ? { apiKey, appId } : null;
}

/** OneDrive picker: the Azure app registration's client id (public), or null. */
export function oneDriveConfig(): { clientId: string } | null {
  const clientId = read('MICROSOFT_CLIENT_ID');
  return clientId ? { clientId } : null;
}

// Kept on globalThis so Vite's dev-time module reloads don't mint a new secret (and sign everyone out).
const devSecretStore = globalThis as typeof globalThis & { __scanwiseDevSessionSecret?: Uint8Array };

function devSessionSecret(): Uint8Array {
  if (!devSecretStore.__scanwiseDevSessionSecret) {
    devSecretStore.__scanwiseDevSessionSecret = new Uint8Array(randomBytes(48));
    console.warn(
      '[scanwise] SESSION_SECRET is not set; using a temporary secret for local development. ' +
        'Sessions end when the dev server restarts.',
    );
  }
  return devSecretStore.__scanwiseDevSessionSecret;
}

type SecretLookup = { secret: Uint8Array } | { problem: string };

function lookupSessionSecret(): SecretLookup {
  const value = read('SESSION_SECRET');
  if (value === null) {
    return isLocalDev() ? { secret: devSessionSecret() } : { problem: 'SESSION_SECRET is not set.' };
  }
  if (value.length < MIN_SESSION_SECRET_LENGTH) {
    return { problem: `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters.` };
  }
  return { secret: new TextEncoder().encode(value) };
}

/** HS256 key for session tokens. */
export function sessionSecret(): Uint8Array {
  const lookup = lookupSessionSecret();
  if ('problem' in lookup) throw notConfigured(SIGN_IN_NOT_CONFIGURED, lookup.problem);
  return lookup.secret;
}

/** The Google client id to advertise, or null when sign-in can't complete (no client id or no usable session secret). */
export function signInClientId(): string | null {
  const id = googleClientId();
  return id && 'secret' in lookupSessionSecret() ? id : null;
}
