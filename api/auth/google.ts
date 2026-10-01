import { requireGoogleClientId } from '../../server/env.js';
import { verifyGoogleIdToken } from '../../server/google.js';
import { assertSameOrigin, json, readJson, route } from '../../server/http.js';
import { createSessionToken, sessionCookie } from '../../server/session.js';
import { validateGoogleSignIn } from '../../server/validate.js';
import type { SessionResponse } from '../../shared/types.js';

/** A Google ID token is ~1–2 KB. */
const MAX_BODY_BYTES = 16 * 1024;

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const clientId = requireGoogleClientId();
  const { credential } = validateGoogleSignIn(
    await readJson(request, MAX_BODY_BYTES, 'The sign-in request is too large.'),
  );
  const user = await verifyGoogleIdToken(credential, clientId);
  const token = await createSessionToken(user);
  return json({ user } satisfies SessionResponse, {
    headers: { 'Set-Cookie': sessionCookie(token, request) },
  });
});
