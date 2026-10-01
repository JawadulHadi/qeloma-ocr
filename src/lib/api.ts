import { MAX_AUDIO_BASE64_CHARS, MAX_VISION_BASE64_CHARS } from '../../shared/limits';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ApiErrorBody,
  AuthConfig,
  ChatRequest,
  GoogleSignInRequest,
  SessionResponse,
  SessionUser,
  TranscribeRequest,
  TranscribeResponse,
  VisionRequest,
  VisionResponse,
} from '../../shared/types';
import type { VisionFn } from './extract/types';

/** An /api request that failed. `message` is written for the end user. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const OFFLINE_MESSAGE = "Can't reach Scanwise. Check your connection and try again.";
const INTERRUPTED_MESSAGE = 'The answer was interrupted. Check your connection and ask again.';
const UNEXPECTED_REPLY_MESSAGE = 'Scanwise got an unexpected reply from the server. Reload the page and try again.';
const VISION_TOO_LARGE_MESSAGE = 'This image is too large for AI vision. Try a smaller or lower-resolution image.';
const RECORDING_TOO_LARGE_MESSAGE = 'This recording is too long to transcribe. Keep it under two minutes.';

/** Used when an error response has no JSON body (proxy errors, platform timeouts, dev server fallbacks). */
const FALLBACK_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'bad_request', message: "Scanwise couldn't process that request. Reload the page and try again." },
  401: { code: 'unauthorized', message: 'Your session expired. Sign in again.' },
  403: { code: 'forbidden', message: 'Scanwise blocked this request. Reload the page and try again.' },
  404: { code: 'not_found', message: "Scanwise couldn't find what it needed. Reload the page and try again." },
  405: { code: 'method_not_allowed', message: "Scanwise couldn't process that request. Reload the page and try again." },
  413: { code: 'payload_too_large', message: "That's too large to send. Try a smaller file or shorter text." },
  422: { code: 'blocked', message: 'The AI declined to process this content.' },
  429: { code: 'rate_limited', message: 'Too many requests right now. Wait a minute and try again.' },
  500: { code: 'internal', message: 'Something went wrong on the server. Try again in a moment.' },
  502: { code: 'ai_unavailable', message: 'The AI service is unavailable right now. Try again in a moment.' },
  503: { code: 'not_configured', message: "Scanwise isn't fully set up on the server yet. Try again later." },
  504: { code: 'timeout', message: 'Scanwise took too long to respond. Try again.' },
};

function fallbackError(status: number): ApiError {
  const known = FALLBACK_ERRORS[status] ?? (status >= 500 ? FALLBACK_ERRORS[500] : undefined);
  return known
    ? new ApiError(status, known.code, known.message)
    : new ApiError(status, 'http_error', `Scanwise returned an unexpected error (${status}). Try again.`);
}

/** True for a fetch/stream that was cancelled through an AbortSignal. */
export function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

/** The user-facing message of an ApiError, or `fallback` for anything else. */
export function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    typeof error.code === 'string' &&
    typeof error.message === 'string' &&
    error.message.length > 0
  );
}

// ---- Session expiry -----------------------------------------------------------

const unauthorizedListeners = new Set<() => void>();

/** Subscribes to 401s from endpoints that need a session. Returns an unsubscribe function. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

// ---- Transport -----------------------------------------------------------------

interface RequestOptions {
  method?: 'GET' | 'POST';
  /** JSON body; every POST sends one (an empty object when omitted). */
  body?: unknown;
  signal?: AbortSignal;
  /** The endpoint needs a session: a 401 means it expired, so listeners are told. */
  session?: boolean;
}

async function request(path: string, { method = 'GET', body, signal, session = false }: RequestOptions = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      signal,
      credentials: 'same-origin',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    throw new ApiError(0, 'network', OFFLINE_MESSAGE);
  }
  if (response.ok) return response;

  if (response.status === 401 && session) {
    for (const listener of [...unauthorizedListeners]) listener();
  }
  const errorBody: unknown = await response.json().catch(() => null);
  if (isApiErrorBody(errorBody)) {
    throw new ApiError(response.status, errorBody.error.code, errorBody.error.message);
  }
  throw fallbackError(response.status);
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new ApiError(response.status, 'bad_response', UNEXPECTED_REPLY_MESSAGE);
  }
}

// ---- Auth ------------------------------------------------------------------------

export async function getAuthConfig(): Promise<AuthConfig> {
  return readJson<AuthConfig>(await request('/api/auth/config'));
}

/** The signed-in user, or null when there is no valid session. */
export async function getMe(): Promise<SessionUser | null> {
  try {
    const { user } = await readJson<SessionResponse>(await request('/api/auth/me'));
    return user;
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function signInWithGoogle(credential: string): Promise<SessionUser> {
  const body: GoogleSignInRequest = { credential };
  const { user } = await readJson<SessionResponse>(await request('/api/auth/google', { method: 'POST', body }));
  return user;
}

export async function signOut(): Promise<void> {
  await request('/api/auth/logout', { method: 'POST' });
}

// ---- AI ---------------------------------------------------------------------------

export async function analyzeSources(req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  return readJson<AnalyzeResponse>(await request('/api/analyze', { method: 'POST', body: req, signal, session: true }));
}

/**
 * Streams the assistant's Markdown answer, calling `onChunk` with the whole answer so far as text arrives.
 * Resolves with the complete answer. Aborting rejects with the signal's AbortError.
 */
export async function streamChat(
  req: ChatRequest,
  opts: { signal?: AbortSignal; onChunk(textSoFar: string): void },
): Promise<string> {
  const { signal, onChunk } = opts;
  const response = await request('/api/chat', { method: 'POST', body: req, signal, session: true });
  if (!response.body) return '';

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // stream: true keeps a multi-byte character that is split across chunks intact.
      const piece = decoder.decode(value, { stream: true });
      if (piece) {
        text += piece;
        onChunk(text);
      }
    }
  } catch (err) {
    if (isAbortError(err) || signal?.aborted) throw err;
    throw new ApiError(0, 'network', INTERRUPTED_MESSAGE);
  }
  const rest = decoder.decode();
  if (rest) {
    text += rest;
    onChunk(text);
  }
  return text;
}

/** Bytes per btoa() call: a multiple of 3, so the base64 pieces concatenate without padding in between. */
const BASE64_CHUNK_BYTES = 3 * 8192;

/** Base64 of a Blob's bytes, without a `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const parts: string[] = [];
  for (let start = 0; start < bytes.length; start += BASE64_CHUNK_BYTES) {
    parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + BASE64_CHUNK_BYTES))));
  }
  return parts.join('');
}

/** Sends an image (or scanned page) to AI vision and returns its transcription. */
export const readWithVision: VisionFn = async (image, { language, signal }) => {
  if (Math.ceil(image.size / 3) * 4 > MAX_VISION_BASE64_CHARS) {
    throw new ApiError(413, 'payload_too_large', VISION_TOO_LARGE_MESSAGE);
  }
  const base64 = await blobToBase64(image);
  signal?.throwIfAborted();
  const body: VisionRequest = { image: base64, mimeType: image.type || 'image/png', language };
  const { text } = await readJson<VisionResponse>(
    await request('/api/vision', { method: 'POST', body, signal, session: true }),
  );
  return text;
};

/** Sends a voice recording for transcription (browsers without built-in speech recognition). */
export async function transcribeRecording(audio: Blob, signal?: AbortSignal): Promise<string> {
  if (Math.ceil(audio.size / 3) * 4 > MAX_AUDIO_BASE64_CHARS) {
    throw new ApiError(413, 'payload_too_large', RECORDING_TOO_LARGE_MESSAGE);
  }
  const body: TranscribeRequest = { audio: await blobToBase64(audio), mimeType: audio.type || 'audio/webm' };
  signal?.throwIfAborted();
  const { text } = await readJson<TranscribeResponse>(
    await request('/api/transcribe', { method: 'POST', body, signal, session: true }),
  );
  return text;
}
