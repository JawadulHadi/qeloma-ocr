import { geminiModel } from '../server/env.js';
import { analyzeSources } from '../server/gemini.js';
import { assertSameOrigin, json, readJson, route } from '../server/http.js';
import { requireUser } from '../server/session.js';
import { validateAnalyzeRequest } from '../server/validate.js';
import type { AnalyzeResponse } from '../shared/types.js';

/** Under Vercel's 4.5 MB body cap; text beyond MAX_ANALYZE_CHARS in total is truncated, not rejected. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await requireUser(request);
  const { sources } = validateAnalyzeRequest(
    await readJson(request, MAX_BODY_BYTES, 'These sources are too large to send. Leave some out and try again.'),
  );
  const analysis = await analyzeSources(sources, { signal: request.signal });
  const truncated = sources.some((source) => source.truncated);
  return json({ analysis, model: geminiModel(), truncated } satisfies AnalyzeResponse);
});
