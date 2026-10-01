import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpError, assertSameOrigin, errorResponse, isHttps, json, readJson, route } from './http.js';
import { ORIGIN, errorOf } from './test-utils.js';

afterEach(() => {
  vi.restoreAllMocks();
});

// BodyInit is a DOM global; tsconfig.api.json has no DOM lib, so take the type from RequestInit instead.
function post(body: RequestInit['body'], headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/test`, { method: 'POST', body, headers, duplex: 'half' } as RequestInit);
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('json', () => {
  it('serializes the body with JSON and no-store headers', async () => {
    const response = json({ ok: true }, { status: 201 });
    expect(response.status).toBe(201);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('errorResponse', () => {
  it('maps an HttpError to its status and ApiErrorBody without logging client errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = errorResponse(new HttpError(400, 'bad_request', 'Type a question first.'));
    expect(response.status).toBe(400);
    expect(await errorOf(response)).toEqual({ code: 'bad_request', message: 'Type a question first.' });
    expect(log).not.toHaveBeenCalled();
  });

  it('logs the cause of server-side HttpErrors but never sends it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = errorResponse(
      new HttpError(503, 'not_configured', "AI analysis isn't configured on this server yet.", { cause: 'GEMINI_API_KEY is not set.' }),
    );
    expect(response.status).toBe(503);
    const text = await response.text();
    expect(text).not.toContain('GEMINI_API_KEY');
    expect(log).toHaveBeenCalledWith('[api] not_configured:', 'GEMINI_API_KEY is not set.');
  });

  it('turns unknown errors into a generic 500 and logs them', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const boom = new Error('database password is hunter2');
    const response = errorResponse(boom);
    expect(response.status).toBe(500);
    const error = await errorOf(response);
    expect(error.code).toBe('internal');
    expect(error.message).not.toContain('hunter2');
    expect(log).toHaveBeenCalledWith('[api] Unexpected error:', boom);
  });
});

describe('route', () => {
  it('sets Cache-Control: no-store on handler responses', async () => {
    const handler = route(async () => new Response('hi', { headers: { 'Cache-Control': 'max-age=60' } }));
    const response = await handler(new Request(`${ORIGIN}/api/x`));
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('hi');
  });

  it('turns thrown errors into JSON error responses', async () => {
    const handler = route(async () => {
      throw new HttpError(401, 'unauthorized', 'Sign in to continue.');
    });
    const response = await handler(new Request(`${ORIGIN}/api/x`));
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await errorOf(response)).toEqual({ code: 'unauthorized', message: 'Sign in to continue.' });
  });
});

describe('readJson', () => {
  it('parses a JSON body', async () => {
    await expect(readJson(post('{"a":1}', { 'Content-Type': 'application/json' }), 100)).resolves.toEqual({ a: 1 });
  });

  it('accepts a charset parameter on the content type', async () => {
    const request = post('{"a":"ü"}', { 'Content-Type': 'application/json; charset=utf-8' });
    await expect(readJson(request, 100)).resolves.toEqual({ a: 'ü' });
  });

  it.each([
    ['missing', {}],
    ['text/plain', { 'Content-Type': 'text/plain' }],
    ['form data', { 'Content-Type': 'application/x-www-form-urlencoded' }],
    ['a JSON look-alike', { 'Content-Type': 'application/jsonp' }],
  ])('rejects a %s content type with 400', async (_label, headers) => {
    await expect(readJson(post('{}', headers), 100)).rejects.toMatchObject({ status: 400, code: 'bad_request' });
  });

  it('rejects a declared Content-Length over the limit before reading', async () => {
    const request = post('{}', { 'Content-Type': 'application/json', 'Content-Length': '5000' });
    await expect(readJson(request, 100, 'Too big.')).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
      message: 'Too big.',
    });
  });

  it('enforces the limit on the bytes actually received', async () => {
    const request = post(streamOf('{"text":"', 'x'.repeat(80), 'y'.repeat(80), '"}'), {
      'Content-Type': 'application/json',
    });
    expect(request.headers.get('Content-Length')).toBeNull();
    await expect(readJson(request, 100)).rejects.toMatchObject({ status: 413 });
  });

  it('counts bytes, not characters', async () => {
    // 40 three-byte characters = 120 bytes.
    const request = post(JSON.stringify({ t: '€'.repeat(40) }), { 'Content-Type': 'application/json' });
    await expect(readJson(request, 100)).rejects.toMatchObject({ status: 413 });
  });

  it('rejects invalid JSON with 400', async () => {
    await expect(readJson(post('{"a":', { 'Content-Type': 'application/json' }), 100)).rejects.toMatchObject({
      status: 400,
      message: "The request body isn't valid JSON.",
    });
  });

  it('rejects an empty body with 400', async () => {
    await expect(readJson(post(null, { 'Content-Type': 'application/json' }), 100)).rejects.toMatchObject({ status: 400 });
    await expect(readJson(post('  ', { 'Content-Type': 'application/json' }), 100)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects bytes that are not UTF-8', async () => {
    const request = post(new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]), { 'Content-Type': 'application/json' });
    await expect(readJson(request, 100)).rejects.toMatchObject({ status: 400 });
  });
});

describe('assertSameOrigin', () => {
  function withHeaders(headers: Record<string, string>, url = `${ORIGIN}/api/analyze`): Request {
    return new Request(url, { method: 'POST', headers });
  }

  it('allows a request from this origin', () => {
    expect(() => assertSameOrigin(withHeaders({ Origin: ORIGIN }))).not.toThrow();
  });

  it('allows the public origin reported by the proxy', () => {
    const request = withHeaders(
      { Origin: 'https://scanwise.app', 'X-Forwarded-Host': 'scanwise.app', 'X-Forwarded-Proto': 'https' },
      'http://127.0.0.1:3000/api/analyze',
    );
    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it.each([
    ['another site', { Origin: 'https://evil.example' }],
    ['another port', { Origin: 'http://localhost:4000' }],
    ['another scheme', { Origin: 'https://localhost:3000' }],
    ['an opaque origin', { Origin: 'null' }],
    ['a malformed origin', { Origin: 'not a url' }],
    ['a forwarded host that does not match', { Origin: 'https://evil.example', 'X-Forwarded-Host': 'scanwise.app' }],
  ])('blocks %s with 403', (_label, headers) => {
    expect(() => assertSameOrigin(withHeaders(headers))).toThrow(expect.objectContaining({ status: 403, code: 'forbidden' }));
  });

  it.each(['same-origin', 'none'])('allows a missing Origin when Sec-Fetch-Site is %s', (site) => {
    expect(() => assertSameOrigin(withHeaders({ 'Sec-Fetch-Site': site }))).not.toThrow();
  });

  it.each([['cross-site'], ['same-site'], [null]])('blocks a missing Origin when Sec-Fetch-Site is %s', (site) => {
    const headers: Record<string, string> = site ? { 'Sec-Fetch-Site': site } : {};
    expect(() => assertSameOrigin(withHeaders(headers))).toThrow(expect.objectContaining({ status: 403 }));
  });
});

describe('isHttps', () => {
  it('reads the scheme from the URL or the proxy header', () => {
    expect(isHttps(new Request('https://scanwise.app/api/x'))).toBe(true);
    expect(isHttps(new Request('http://localhost:3000/api/x'))).toBe(false);
    expect(isHttps(new Request('http://10.0.0.1/api/x', { headers: { 'X-Forwarded-Proto': 'https' } }))).toBe(true);
    expect(isHttps(new Request('http://10.0.0.1/api/x', { headers: { 'X-Forwarded-Proto': 'http' } }))).toBe(false);
  });
});
