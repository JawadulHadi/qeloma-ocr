import { errorResponse, json, route } from '../../server/http.js';
import { clearSessionCookie, readSessionToken, requireUser } from '../../server/session.js';
import type { SessionResponse } from '../../shared/types.js';

export const GET = route(async (request) => {
  try {
    return json({ user: await requireUser(request) } satisfies SessionResponse);
  } catch (err) {
    const response = errorResponse(err);
    // A cookie that no longer verifies (expired, or signed with a rotated secret) is dropped.
    if (response.status === 401 && readSessionToken(request)) {
      response.headers.append('Set-Cookie', clearSessionCookie(request));
    }
    return response;
  }
});
