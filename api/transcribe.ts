import { geminiModel } from '../server/env.js';
import { transcribeAudio } from '../server/gemini.js';
import { assertSameOrigin, json, readJson, route } from '../server/http.js';
import { requireUser } from '../server/session.js';
import { AUDIO_TOO_LARGE_MESSAGE, validateTranscribeRequest } from '../server/validate.js';
import { MAX_AUDIO_BASE64_CHARS } from '../shared/limits.js';
import type { TranscribeResponse } from '../shared/types.js';

/** The base64 recording plus room for the JSON around it. */
const MAX_BODY_BYTES = MAX_AUDIO_BASE64_CHARS + 64 * 1024;

/** Voice input for browsers without built-in speech recognition. */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  await requireUser(request);
  const { audio, mimeType } = validateTranscribeRequest(await readJson(request, MAX_BODY_BYTES, AUDIO_TOO_LARGE_MESSAGE));
  const text = await transcribeAudio(audio, mimeType, { signal: request.signal });
  return json({ text, model: geminiModel() } satisfies TranscribeResponse);
});
