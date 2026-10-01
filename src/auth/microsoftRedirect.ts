import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

// The OneDrive sign-in pop-up lands here. MSAL passes the result to the opening window, which closes the pop-up.
broadcastResponseToMainFrame().catch(() => window.close());
