import { geminiModel } from '../server/env.js';
import { analyzeDocument } from '../server/gemini.js';
import { assertSameOrigin, json, readJson, route } from '../server/http.js';
import { requireUser } from '../server/session.js';
import { validateAnalyzeRequest } from '../server/validate.js';
import type { AnalyzeResponse } from '../shared/types.js';

/** Under Vercel's 4.5 MB body cap; text beyond MAX_ANALYZE_CHARS is truncated, not rejected. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await requireUser(request);
  const { text, document, truncated } = validateAnalyzeRequest(
    await readJson(request, MAX_BODY_BYTES, "This document's text is too large to send."),
  );
  const analysis = await analyzeDocument(text, document, { truncated, signal: request.signal });
  return json({ analysis, model: geminiModel(), truncated } satisfies AnalyzeResponse);
});
