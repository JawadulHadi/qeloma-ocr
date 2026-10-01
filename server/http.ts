import type { ApiErrorBody } from '../shared/types.js';

export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_request'
  | 'payload_too_large'
  | 'forbidden'
  | 'not_configured'
  | 'ai_unavailable'
  | 'rate_limited'
  | 'blocked'
  | 'method_not_allowed'
  | 'not_found'
  | 'internal';

/**
 * An error that maps directly to an API response. `message` is shown to the end user;
 * `cause` is for operators only (logged for 5xx responses, never sent to the client).
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;

  constructor(status: number, code: ApiErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const INTERNAL_MESSAGE = 'Something went wrong on our side. Try again.';

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * Logs what an operator needs to see: unexpected errors, and 5xx HttpErrors with their cause.
 * Only error objects are logged — never request bodies or document text.
 */
export function reportError(err: unknown): void {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error(`[api] ${err.code}:`, err.cause ?? err.message);
    return;
  }
  console.error('[api] Unexpected error:', err);
}

export function errorResponse(err: unknown): Response {
  reportError(err);
  const [status, error]: [number, ApiErrorBody['error']] =
    err instanceof HttpError
      ? [err.status, { code: err.code, message: err.message }]
      : [500, { code: 'internal', message: INTERNAL_MESSAGE }];
  return json({ error } satisfies ApiErrorBody, { status });
}

/** Wraps a handler so every failure becomes a JSON ApiErrorBody and no API response is cached. */
export function route(
  handler: (request: Request) => Promise<Response>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    let response: Response;
    try {
      response = await handler(request);
    } catch (err) {
      response = errorResponse(err);
    }
    response.headers.set('Cache-Control', 'no-store');
    return response;
  };
}

const JSON_CONTENT_TYPE = /^application\/json\s*(;|$)/i;

/**
 * Reads a JSON body of at most `maxBytes`, checking both the declared Content-Length and the
 * bytes actually received (a client can omit or understate Content-Length).
 */
export async function readJson(
  request: Request,
  maxBytes: number,
  tooLargeMessage = 'This request is too large.',
): Promise<unknown> {
  if (!JSON_CONTENT_TYPE.test(request.headers.get('Content-Type') ?? '')) {
    throw new HttpError(400, 'bad_request', 'Send the request body as JSON.');
  }
  const tooLarge = () => new HttpError(413, 'payload_too_large', tooLargeMessage);
  if (Number(request.headers.get('Content-Length')) > maxBytes) throw tooLarge();
  if (!request.body) throw new HttpError(400, 'bad_request', 'The request body is empty.');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpError(400, 'bad_request', "The request body isn't valid UTF-8 text.");
  }
  if (!text.trim()) throw new HttpError(400, 'bad_request', 'The request body is empty.');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'bad_request', "The request body isn't valid JSON.");
  }
}

/** First value of a possibly comma-separated proxy header, e.g. "https, http" → "https". */
export function firstHeaderValue(request: Request, name: string): string | null {
  const value = request.headers.get(name)?.split(',')[0]?.trim();
  return value ? value : null;
}

/** True when the client reached us over HTTPS, directly or through the platform's proxy. */
export function isHttps(request: Request): boolean {
  return (
    new URL(request.url).protocol === 'https:' ||
    firstHeaderValue(request, 'X-Forwarded-Proto')?.toLowerCase() === 'https'
  );
}

function ownOrigins(request: Request): Set<string> {
  const url = new URL(request.url);
  const origins = new Set([url.origin]);
  const forwardedHost = firstHeaderValue(request, 'X-Forwarded-Host');
  if (forwardedHost) {
    const proto = firstHeaderValue(request, 'X-Forwarded-Proto')?.toLowerCase() ?? url.protocol.slice(0, -1);
    if (proto === 'http' || proto === 'https') {
      try {
        origins.add(new URL(`${proto}://${forwardedHost}`).origin);
      } catch {
        // A malformed forwarded host simply isn't an acceptable origin.
      }
    }
  }
  return origins;
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for state-changing requests: the browser-supplied Origin must be this site.
 * Without an Origin header, only Fetch Metadata proving a same-origin (or user-initiated) request passes.
 */
export function assertSameOrigin(request: Request): void {
  const forbidden = () => new HttpError(403, 'forbidden', 'This request came from another site and was blocked.');
  const origin = request.headers.get('Origin');
  if (origin === null) {
    const site = request.headers.get('Sec-Fetch-Site');
    if (site === 'same-origin' || site === 'none') return;
    throw forbidden();
  }
  const normalized = normalizeOrigin(origin);
  if (normalized === null || normalized === 'null' || !ownOrigins(request).has(normalized)) throw forbidden();
}
