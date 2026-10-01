/**
 * Google Drive: Google's own file picker, with read access only to the files the person picks (the drive.file
 * scope). Native Google Docs, Sheets and Slides are exported to Word, Excel and PowerPoint and read like uploads.
 * https://developers.google.com/workspace/drive/picker/guides/web-picker
 */
import { MAX_SOURCES, MAX_UPLOAD_BYTES } from '../../../shared/limits';
import { loadGoogleIdentity } from '../../auth/googleIdentity';
import type { Bundle, SkippedFile } from '../bundle';
import { MIME, formatMegabytes } from '../extract/detect';
import { PickerError, loadScript } from './common';

const GAPI_URL = 'https://apis.google.com/js/api.js';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files';

/** Native Google formats and what they are exported as. Drive caps exports at 10 MB. */
const EXPORTS: Record<string, { mimeType: string; ext: string }> = {
  'application/vnd.google-apps.document': { mimeType: MIME.docx, ext: 'docx' },
  'application/vnd.google-apps.spreadsheet': { mimeType: MIME.xlsx, ext: 'xlsx' },
  'application/vnd.google-apps.presentation': { mimeType: MIME.pptx, ext: 'pptx' },
};

// ---- The parts of gapi, the Picker API and the GIS token client used here --------------------------------------

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string }): void;
}

interface PickedDoc {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number | string;
}

interface PickerResponse {
  action: string;
  docs?: PickedDoc[];
}

interface PickerBuilder {
  addView(view: unknown): PickerBuilder;
  enableFeature(feature: string): PickerBuilder;
  setMaxItems(max: number): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setOrigin(origin: string): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  setCallback(callback: (response: PickerResponse) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface DocsView {
  setIncludeFolders(include: boolean): DocsView;
  setSelectFolderEnabled(enabled: boolean): DocsView;
}

interface PickerNamespace {
  PickerBuilder: new () => PickerBuilder;
  DocsView: new (viewId?: string) => DocsView;
  ViewId: { DOCS: string };
  Feature: { MULTISELECT_ENABLED: string };
  Action: { PICKED: string; CANCEL: string };
}

interface GoogleWithPicker {
  picker?: PickerNamespace;
  accounts?: {
    oauth2?: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (response: TokenResponse) => void;
        error_callback?: (error: { type: string }) => void;
      }): TokenClient;
    };
  };
}

interface Gapi {
  load(name: string, options: { callback: () => void; onerror: () => void }): void;
}

function google(): GoogleWithPicker {
  return (window as unknown as { google?: GoogleWithPicker }).google ?? {};
}

// ---- Loading and access --------------------------------------------------------------------------------------

let pickerReady: Promise<PickerNamespace> | null = null;

function loadPicker(): Promise<PickerNamespace> {
  pickerReady ??= loadScript(GAPI_URL)
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          const gapi = (window as unknown as { gapi?: Gapi }).gapi;
          if (!gapi) reject(new PickerError('Google Drive couldn’t load. Check your connection and try again.'));
          else gapi.load('picker', { callback: resolve, onerror: () => reject(new PickerError('Google Drive couldn’t load.')) });
        }),
    )
    .then(() => {
      const picker = google().picker;
      if (!picker) throw new PickerError('Google Drive couldn’t load. Check your connection and try again.');
      return picker;
    })
    .catch((err: unknown) => {
      pickerReady = null;
      throw err;
    });
  return pickerReady;
}

let cachedToken: { clientId: string; token: string; expiresAt: number } | null = null;

/** An access token for the files the person picks; Google asks for consent the first time. */
async function accessToken(clientId: string): Promise<string> {
  if (cachedToken && cachedToken.clientId === clientId && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  await loadGoogleIdentity();
  const oauth2 = google().accounts?.oauth2;
  if (!oauth2) throw new PickerError('Google sign-in couldn’t load. Check your connection and try again.');
  return new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (!response.access_token) {
          reject(new PickerError('Google Drive access wasn’t granted.'));
          return;
        }
        cachedToken = { clientId, token: response.access_token, expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000 };
        resolve(response.access_token);
      },
      error_callback: (error) =>
        reject(
          error.type === 'popup_closed'
            ? new PickerError(null)
            : new PickerError('Google Drive couldn’t open its sign-in window. Allow pop-ups for this site and try again.'),
        ),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

function showPicker(picker: PickerNamespace, token: string, apiKey: string, appId: string): Promise<PickedDoc[]> {
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setMaxItems(MAX_SOURCES)
      .setOAuthToken(token)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setOrigin(window.location.origin)
      .setTitle('Choose documents for Scanwise')
      .setCallback((response) => {
        if (response.action === picker.Action.PICKED) resolve(response.docs ?? []);
        else if (response.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}

async function download(doc: PickedDoc, token: string): Promise<File> {
  const exportAs = EXPORTS[doc.mimeType];
  if (!exportAs && doc.mimeType.startsWith('application/vnd.google-apps.')) {
    throw new PickerError('Only Google Docs, Sheets and Slides can be read from Drive’s own formats.');
  }
  if (Number(doc.sizeBytes) > MAX_UPLOAD_BYTES) {
    throw new PickerError(`It is over the ${formatMegabytes(MAX_UPLOAD_BYTES)} limit for one file.`);
  }
  const id = encodeURIComponent(doc.id);
  const url = exportAs
    ? `${DRIVE_FILES}/${id}/export?mimeType=${encodeURIComponent(exportAs.mimeType)}`
    : `${DRIVE_FILES}/${id}?alt=media&supportsAllDrives=true`;
  let response: Response;
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new PickerError('It couldn’t be downloaded. Check your connection and try again.');
  }
  if (!response.ok) {
    throw new PickerError(
      exportAs && response.status === 403
        ? 'Google couldn’t convert it (exports are limited to 10 MB). Download it from Drive and upload it instead.'
        : 'Google Drive didn’t send it. Try again.',
    );
  }
  const blob = await response.blob();
  const name = exportAs && !doc.name.toLowerCase().endsWith(`.${exportAs.ext}`) ? `${doc.name}.${exportAs.ext}` : doc.name;
  return new File([blob], name, { type: exportAs?.mimeType ?? doc.mimeType });
}

/**
 * Lets the person pick files in Google Drive and downloads them. Resolves with no files when they cancel.
 * Must start from a click: the consent window is a pop-up.
 */
export async function pickFromDrive(config: { clientId: string; apiKey: string; appId: string }): Promise<Bundle> {
  const [picker, token] = await Promise.all([loadPicker(), accessToken(config.clientId)]);
  const docs = await showPicker(picker, token, config.apiKey, config.appId);
  const files: File[] = [];
  const skipped: SkippedFile[] = [];
  for (const doc of docs) {
    try {
      files.push(await download(doc, token));
    } catch (err) {
      skipped.push({ name: doc.name, reason: err instanceof PickerError && err.message ? err.message : 'It couldn’t be downloaded.' });
    }
  }
  return { files, skipped };
}
