import { assertSameOrigin, route } from '../../server/http.js';
import { clearSessionCookie } from '../../server/session.js';

export const POST = route(async (request) => {
  assertSameOrigin(request);
  return new Response(null, { status: 204, headers: { 'Set-Cookie': clearSessionCookie(request) } });
});
