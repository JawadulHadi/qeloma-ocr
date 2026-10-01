import { driveConfig, geminiApiKey, geminiModel, oneDriveConfig, signInClientId } from '../../server/env.js';
import { json, route } from '../../server/http.js';
import type { AuthConfig } from '../../shared/types.js';

export const GET = route(async () => {
  const googleClientId = signInClientId();
  return json({
    googleClientId,
    aiConfigured: geminiApiKey() !== null,
    model: geminiModel(),
    // The Drive picker signs in with the same OAuth client, so it needs Google sign-in set up too.
    drive: googleClientId ? driveConfig() : null,
    oneDrive: oneDriveConfig(),
  } satisfies AuthConfig);
});
