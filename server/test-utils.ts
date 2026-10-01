/** Fixtures shared by the server test files (imported only by *.test.ts). */
import { vi } from 'vitest';
import type { Analysis, ApiErrorBody, DocumentMeta, SessionUser } from '../shared/types.js';
import { SESSION_COOKIE, createSessionToken } from './session.js';

export const ORIGIN = 'http://localhost:3000';
export const TEST_SESSION_SECRET = 'test-session-secret-with-more-than-32-characters';
export const TEST_CLIENT_ID = 'client-123.apps.googleusercontent.com';

export const testUser: SessionUser = {
  id: '109876543210',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  picture: 'https://lh3.googleusercontent.com/a/ada',
};

export const sampleMeta: DocumentMeta = {
  fileName: 'electricity-bill.pdf',
  mimeType: 'application/pdf',
  kind: 'pdf',
  pageCount: 2,
  meanConfidence: null,
  engine: 'PDF text layer',
};

export const sampleAnalysis: Analysis = {
  title: 'Electricity bill — September 2026',
  documentType: 'Utility bill',
  language: 'English',
  summary: 'Your September electricity bill is Rs 8,450, due on 15 October 2026.',
  keyFactors: [{ label: 'Amount due', detail: 'Rs 8,450 must be paid by 15 October 2026.', importance: 'high' }],
  keyPoints: ['Usage was 312 units, up 12% on August.'],
  solutions: [
    {
      title: 'Pay online before the due date',
      description: 'The bill lists online banking as a payment method.',
      steps: ['Open your banking app', 'Choose bill payment', 'Enter the reference number'],
      source: 'document',
    },
  ],
  openQuestions: ['Why did usage rise in September?'],
  caveats: [],
};

/** Every variable the server reads, set to working test values. */
export function stubServerEnv(): void {
  vi.stubEnv('SESSION_SECRET', TEST_SESSION_SECRET);
  vi.stubEnv('GOOGLE_CLIENT_ID', TEST_CLIENT_ID);
  vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key');
  vi.stubEnv('GEMINI_MODEL', '');
  vi.stubEnv('SCANWISE_DEV', '');
}

export interface TestRequestOptions {
  method?: string;
  /** Serialized as JSON with Content-Type: application/json. */
  body?: unknown;
  cookie?: string;
  /** Defaults to this site's origin; null omits the header. */
  origin?: string | null;
  headers?: Record<string, string>;
}

export function apiRequest(path: string, opts: TestRequestOptions = {}): Request {
  const headers = new Headers(opts.headers);
  if (opts.origin !== null) headers.set('Origin', opts.origin ?? ORIGIN);
  if (opts.cookie) headers.set('Cookie', opts.cookie);
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  if (body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return new Request(`${ORIGIN}${path}`, { method: opts.method ?? (body === undefined ? 'GET' : 'POST'), headers, body });
}

export async function sessionCookieHeader(user: SessionUser = testUser): Promise<string> {
  return `${SESSION_COOKIE}=${await createSessionToken(user)}`;
}

export async function errorOf(response: Response): Promise<ApiErrorBody['error']> {
  return ((await response.json()) as ApiErrorBody).error;
}
