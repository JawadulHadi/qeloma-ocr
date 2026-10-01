import { streamChat } from '../server/gemini.js';
import { assertSameOrigin, readJson, reportError, route } from '../server/http.js';
import { requireUser } from '../server/session.js';
import { validateChatRequest } from '../server/validate.js';

/** Under Vercel's 4.5 MB body cap; document text beyond MAX_ANALYZE_CHARS is truncated, not rejected. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Appended when the model fails after part of the answer was already sent. */
const CUT_OFF_NOTE ='\n\n_The answer was cut off. Ask again._';

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await requireUser(request);
  const chat = validateChatRequest(
    await readJson(request, MAX_BODY_BYTES, 'This question and its document are too large to send.'),
  );

  const answer = streamChat(chat, { signal: request.signal });
  // Wait for the first chunk so failures before any text still get a proper JSON error and status.
  const first = await answer.next();

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close();
      else controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const next = await answer.next();
        if (next.done) controller.close();
        else controller.enqueue(encoder.encode(next.value));
      } catch (err) {
        reportError(err);
        controller.enqueue(encoder.encode(CUT_OFF_NOTE));
        controller.close();
      }
    },
    async cancel() {
      await answer.return();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Accel-Buffering': 'no' },
  });
});
