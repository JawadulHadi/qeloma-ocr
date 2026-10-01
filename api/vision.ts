import { geminiModel } from '../server/env.js';
import { transcribeImage } from '../server/gemini.js';
import { assertSameOrigin, json, readJson, route } from '../server/http.js';
import { requireUser } from '../server/session.js';
import { IMAGE_TOO_LARGE_MESSAGE, validateVisionRequest } from '../server/validate.js';
import { MAX_VISION_BASE64_CHARS } from '../shared/limits.js';
import type { VisionResponse } from '../shared/types.js';

/** The base64 image plus room for the JSON around it. */
const MAX_BODY_BYTES = MAX_VISION_BASE64_CHARS + 64 * 1024;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await requireUser(request);
  const { image, mimeType, language } = validateVisionRequest(
    await readJson(request, MAX_BODY_BYTES, IMAGE_TOO_LARGE_MESSAGE),
  );
  const text = await transcribeImage(image, mimeType, { language, signal: request.signal });
  return json({ text, model: geminiModel() } satisfies VisionResponse);
});
