import { geminiApiKey, geminiModel, signInClientId } from '../../server/env.js';
import { json, route } from '../../server/http.js';
import type { AuthConfig } from '../../shared/types.js';

export const GET = route(async () =>
  json({
    googleClientId: signInClientId(),
    aiConfigured: geminiApiKey() !== null,
    model: geminiModel(),
  } satisfies AuthConfig),
);
