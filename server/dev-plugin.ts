/**
 * Serves the Vercel functions in /api from the Vite dev server, so `npm run dev` runs the whole app
 * (auth + AI) without the Vercel CLI. Self-contained on purpose: it is compiled with the Vite config
 * (tsconfig.node.json), not with the functions.
 */
import { statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { loadEnv, type Plugin } from 'vite';

type WebHandler = (request: Request) => Response | Promise<Response>;

export interface ApiMiddlewareOptions {
  root: string;
  /** Loads a handler module from its absolute file path. */
  loadModule(file: string): Promise<Record<string, unknown>>;
  onError(err: unknown): void;
}

const ROUTE_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * Maps a raw (undecoded) request pathname like "/api/auth/me" to `<root>/api/auth/me.ts`, or null.
 * The allow-list rejects anything that could escape /api: dots, "%2e", backslashes, uppercase.
 */
export function resolveApiRoute(root: string, pathname: string): string | null {
  if (!pathname.startsWith('/api/')) return null;
  const route = pathname.slice('/api/'.length);
  if (!ROUTE_PATTERN.test(route)) return null;
  const file = `${path.join(root, 'api', ...route.split('/'))}.ts`;
  return statSync(file, { throwIfNoEntry: false })?.isFile() ? file : null;
}

function isHandler(value: unknown): value is WebHandler {
  return typeof value === 'function';
}

function sendJsonError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    ...headers,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ error: { code, message } }));
}

function toWebRequest(req: IncomingMessage, signal: AbortSignal): Request {
  const encrypted = 'encrypted' in req.socket && req.socket.encrypted === true;
  const authority = req.headers[':authority'];
  const host = req.headers.host ?? (typeof authority === 'string' ? authority : 'localhost');
  const url = new URL(req.url ?? '/', `${encrypted ? 'https' : 'http'}://${host}`);

  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // HTTP/2 pseudo-headers (":path", ":authority"…) aren't valid header names.
    if (value === undefined || name.startsWith(':')) continue;
    for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
  }

  const method = req.method ?? 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  return new Request(url, {
    method,
    headers,
    signal,
    ...(hasBody ? { body: Readable.toWeb(req), duplex: 'half' as const } : {}),
  });
}

async function sendWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    if (name !== 'set-cookie') res.setHeader(name, value);
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('Set-Cookie', cookies);

  if (!response.body) {
    res.end();
    return;
  }
  res.flushHeaders();
  const reader = response.body.getReader();
  for (;;) {
    if (res.destroyed) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    // Written as each chunk arrives, so streamed chat answers show up progressively in dev too.
    if (!res.write(value)) {
      await new Promise<void>((resolve) => {
        res.once('drain', resolve);
        res.once('close', resolve);
      });
    }
  }
  res.end();
}

async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  { root, loadModule, onError }: ApiMiddlewareOptions,
): Promise<void> {
  try {
    const file = resolveApiRoute(root, pathname);
    if (!file) {
      sendJsonError(res, 404, 'not_found', 'There is no API route at this address.');
      return;
    }
    const mod = await loadModule(file);
    const method = (req.method ?? 'GET').toUpperCase();
    const handler = mod[method];
    if (!isHandler(handler)) {
      const allow = HTTP_METHODS.filter((name) => isHandler(mod[name])).join(', ');
      sendJsonError(res, 405, 'method_not_allowed', `This API route doesn't accept ${method} requests.`, { Allow: allow });
      return;
    }

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });
    await sendWebResponse(res, await handler(toWebRequest(req, abort.signal)));
  } catch (err) {
    onError(err);
    if (res.headersSent) res.destroy();
    else sendJsonError(res, 500, 'internal', 'Something went wrong on our side. Try again.');
  }
}

/** Connect middleware that answers /api/* with the matching handler module; everything else falls through. */
export function createApiMiddleware(
  options: ApiMiddlewareOptions,
): (req: IncomingMessage, res: ServerResponse, next: () => void) => void {
  return (req, res, next) => {
    const pathname = (req.url ?? '/').split('?', 1)[0];
    if (pathname !== '/api' && !pathname.startsWith('/api/')) {
      next();
      return;
    }
    void handleApiRequest(req, res, pathname, options);
  };
}

export function apiDevPlugin(): Plugin {
  return {
    name: 'scanwise-api-dev',
    apply: 'serve',
    configureServer(server) {
      const { root, mode, envDir, logger } = server.config;
      // Functions read process.env, as on Vercel. Variables already set in the shell win over .env files.
      for (const [key, value] of Object.entries(loadEnv(mode, envDir, ''))) {
        process.env[key] ??= value;
      }
      process.env.SCANWISE_DEV = '1';

      server.middlewares.use(
        createApiMiddleware({
          root,
          // ssrLoadModule re-evaluates edited modules, so handler changes apply without a restart.
          loadModule: (file) => server.ssrLoadModule(`/${path.relative(root, file).replaceAll('\\', '/')}`),
          onError(err) {
            if (err instanceof Error) server.ssrFixStacktrace(err);
            logger.error(`[api] ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`, {
              timestamp: true,
            });
          },
        }),
      );
    },
  };
}
