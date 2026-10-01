/**
 * OneDrive: Microsoft's current file picker (v8), for personal and work or school accounts, with sign-in through
 * MSAL. This module, and MSAL with it, loads only when someone chooses OneDrive.
 * https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/
 */
import {
  BrowserAuthError,
  createStandardPublicClientApplication,
  type AccountInfo,
  type IPublicClientApplication,
} from '@azure/msal-browser';
import { MAX_UPLOAD_BYTES } from '../../../shared/limits';
import type { Bundle, SkippedFile } from '../bundle';
import { formatMegabytes } from '../extract/detect';
import { PickerError, PopupBlockedError } from './common';

/** The tenant every personal Microsoft account belongs to. */
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';
const CONSUMER_AUTHORITY = 'https://login.microsoftonline.com/consumers';
const PERSONAL_PICKER = 'https://onedrive.live.com/picker';
/** Served by Vite as its own page (auth/microsoft.html): it hands the sign-in result back to this window. */
const REDIRECT_PATH = '/auth/microsoft.html';

/** A signed-in Microsoft account and where its OneDrive lives. */
export interface OneDriveSession {
  pca: IPublicClientApplication;
  account: AccountInfo;
  personal: boolean;
  /** The picker page to open. */
  pickerUrl: string;
  /** For work or school accounts: the SharePoint host of the person's OneDrive. */
  host: string | null;
}

let instance: { clientId: string; ready: Promise<IPublicClientApplication> } | null = null;

function msal(clientId: string): Promise<IPublicClientApplication> {
  if (instance?.clientId !== clientId) {
    instance = {
      clientId,
      ready: createStandardPublicClientApplication({
        auth: {
          clientId,
          authority: 'https://login.microsoftonline.com/common',
          redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
        },
        cache: { cacheLocation: 'sessionStorage' },
      }),
    };
  }
  return instance.ready;
}

function signInError(err: unknown): PickerError {
  if (err instanceof PickerError) return err;
  if (err instanceof BrowserAuthError) {
    if (err.errorCode === 'user_cancelled') return new PickerError(null);
    if (err.errorCode === 'popup_window_error' || err.errorCode === 'empty_window_error') {
      return new PickerError('Microsoft’s sign-in window was blocked. Allow pop-ups for this site and try again.');
    }
  }
  return new PickerError('Couldn’t sign in to Microsoft. Try again.');
}

async function token(session: Pick<OneDriveSession, 'pca' | 'account'>, scopes: string[], authority?: string): Promise<string> {
  const request = { scopes, account: session.account, ...(authority ? { authority } : {}) };
  try {
    return (await session.pca.acquireTokenSilent(request)).accessToken;
  } catch {
    // No usable cached token: ask Microsoft in a pop-up (consent the first time, or a fresh sign-in).
    return (await session.pca.acquireTokenPopup(request)).accessToken;
  }
}

/** A token for the picker or for downloading from `resource` (a SharePoint or OneDrive origin). */
function pickerToken(session: OneDriveSession, resource: string | null): Promise<string> {
  if (session.personal) return token(session, ['OneDrive.ReadOnly'], CONSUMER_AUTHORITY);
  const host = resource ? new URL(resource).origin : session.host;
  if (!host) throw new PickerError('Couldn’t find your OneDrive.');
  return token(session, [`${host}/.default`]);
}

/** Signs in to Microsoft (a pop-up the first time) and finds the account's OneDrive. Must start from a click. */
export async function connectOneDrive(clientId: string): Promise<OneDriveSession> {
  try {
    const pca = await msal(clientId);
    let account = pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
    if (!account) {
      account = (await pca.loginPopup({ scopes: ['User.Read', 'Files.Read'], prompt: 'select_account' })).account;
    }
    pca.setActiveAccount(account);
    if (account.tenantId === CONSUMER_TENANT) {
      return { pca, account, personal: true, pickerUrl: PERSONAL_PICKER, host: null };
    }
    // Work or school: the picker lives on the organization's SharePoint host, which Graph knows.
    const graphToken = await token({ pca, account }, ['Files.Read']);
    const response = await fetch('https://graph.microsoft.com/v1.0/me/drive?$select=webUrl', {
      headers: { Authorization: `Bearer ${graphToken}` },
    });
    if (!response.ok) throw new PickerError('This Microsoft account has no OneDrive, or it isn’t set up yet.');
    const { webUrl } = (await response.json()) as { webUrl?: string };
    if (!webUrl) throw new PickerError('This Microsoft account has no OneDrive, or it isn’t set up yet.');
    const host = new URL(webUrl).origin;
    return { pca, account, personal: false, pickerUrl: `${host}/_layouts/15/FilePicker.aspx`, host };
  } catch (err) {
    throw signInError(err);
  }
}

// ---- The picker window and its messages -------------------------------------------------------------------

interface PickedItem {
  id: string;
  name: string;
  size?: number;
  folder?: unknown;
  parentReference?: { driveId?: string };
  '@sharePoint.endpoint'?: string;
}

interface PickerCommand {
  command: string;
  resource?: string;
  items?: PickedItem[];
}

interface PickerMessage {
  type: string;
  id?: string;
  channelId?: string;
  data?: PickerCommand;
}

async function download(session: OneDriveSession, item: PickedItem): Promise<File> {
  if (item.folder) throw new PickerError('Folders can’t be added. Open the folder and pick the files inside.');
  if ((item.size ?? 0) > MAX_UPLOAD_BYTES) {
    throw new PickerError(`It is over the ${formatMegabytes(MAX_UPLOAD_BYTES)} limit for one file.`);
  }
  const endpoint = item['@sharePoint.endpoint']?.replace(/\/+$/, '');
  const driveId = item.parentReference?.driveId;
  if (!endpoint || !driveId) throw new PickerError('OneDrive didn’t say where to download it from.');
  const accessToken = await pickerToken(session, endpoint);
  let response: Response;
  try {
    response = await fetch(`${endpoint}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item.id)}/content`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new PickerError('It couldn’t be downloaded. Check your connection and try again.');
  }
  if (!response.ok) throw new PickerError('OneDrive didn’t send it. Try again.');
  return new File([await response.blob()], item.name);
}

/**
 * Opens the OneDrive picker and downloads what the person picks. Resolves with no files when they close it.
 * Throws PopupBlockedError when the browser blocks the window; call it again from a fresh click.
 */
export async function pickFromOneDrive(session: OneDriveSession): Promise<Bundle> {
  const picker = window.open('', 'scanwise-onedrive', 'width=1080,height=680');
  if (!picker) throw new PopupBlockedError();
  const channelId = crypto.randomUUID();
  const options = {
    sdk: '8.0',
    entry: { oneDrive: { files: {} } },
    authentication: {},
    messaging: { origin: window.location.origin, channelId },
    selection: { mode: 'multiple' },
    typesAndSources: { mode: 'files', pivots: { oneDrive: true, recent: true } },
  };

  let firstToken: string;
  try {
    firstToken = await pickerToken(session, null);
  } catch (err) {
    picker.close();
    throw signInError(err);
  }

  // The picker page is opened with a POST so the token isn't left in the address bar or history.
  const query = new URLSearchParams({ filePicker: JSON.stringify(options), locale: navigator.language.toLowerCase() });
  const form = picker.document.createElement('form');
  form.method = 'POST';
  form.action = `${session.pickerUrl}?${query}`;
  const tokenInput = picker.document.createElement('input');
  tokenInput.type = 'hidden';
  tokenInput.name = 'access_token';
  tokenInput.value = firstToken;
  form.append(tokenInput);
  picker.document.body.append(form);
  form.submit();

  const items = await new Promise<PickedItem[]>((resolve) => {
    let port: MessagePort | null = null;
    let done = false;

    const finish = (picked: PickedItem[]) => {
      if (done) return;
      done = true;
      window.removeEventListener('message', onWindowMessage);
      window.clearInterval(closedCheck);
      port?.close();
      if (!picker.closed) picker.close();
      resolve(picked);
    };

    const reply = (id: string | undefined, data: unknown) => port?.postMessage({ type: 'result', id, data });

    const onPortMessage = async (event: MessageEvent<PickerMessage>) => {
      const message = event.data;
      if (message.type !== 'command' || !message.data) return;
      port?.postMessage({ type: 'acknowledge', id: message.id });
      const command = message.data;
      switch (command.command) {
        case 'authenticate':
          try {
            reply(message.id, { result: 'token', token: await pickerToken(session, command.resource ?? null) });
          } catch {
            reply(message.id, { result: 'error', error: { code: 'unableToObtainToken', message: 'Sign-in failed.' } });
          }
          break;
        case 'pick':
          reply(message.id, { result: 'success' });
          finish(command.items ?? []);
          break;
        case 'close':
          finish([]);
          break;
        default:
          reply(message.id, { result: 'error', error: { code: 'unsupportedCommand', message: command.command }, isExpected: true });
      }
    };

    const onWindowMessage = (event: MessageEvent<PickerMessage>) => {
      if (event.source !== picker || event.data?.type !== 'initialize' || event.data.channelId !== channelId) return;
      port = event.ports[0] ?? null;
      if (!port) return;
      port.addEventListener('message', (portEvent) => void onPortMessage(portEvent));
      port.start();
      port.postMessage({ type: 'activate' });
    };

    window.addEventListener('message', onWindowMessage);
    const closedCheck = window.setInterval(() => {
      if (picker.closed) finish([]);
    }, 500);
  });

  const files: File[] = [];
  const skipped: SkippedFile[] = [];
  for (const item of items) {
    try {
      files.push(await download(session, item));
    } catch (err) {
      skipped.push({ name: item.name, reason: err instanceof PickerError && err.message ? err.message : 'It couldn’t be downloaded.' });
    }
  }
  return { files, skipped };
}
