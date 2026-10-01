# Scanwise

Add your paperwork — phone photos, scans, PDFs, Office files, a whole folder as a .zip, files from Google Drive
or OneDrive, or pasted text — and Scanwise tells you what it says and what to do about it.

1. **Extract.** Each file becomes a *source* (S1, S2…). Its text is read in your browser, with a confidence
   score for every word (green, amber, red).
2. **Understand.** Gemini reads the ticked sources together and writes one summary: key factors, key points,
   open questions and caveats, each marked with the source it came from, like `[S1]`.
3. **Act.** Solutions are marked *in the sources* or *suggested*. Ask follow-up questions in a chat grounded in
   the sources — by typing, by voice, or by selecting a passage and choosing *Quote in chat*. Answers cite their
   sources too; click a citation to open it. Export everything as Markdown.

No account is needed to read files: *Upload a document* on the landing page reads them on your device. The
summary, chat, AI vision and voice transcription need a Google sign-in; whatever was read before signing in moves
into the account. History is kept per Google account in the browser (IndexedDB); before sign-in it lasts only for
the tab. There is no server-side storage.

## Layout

A conversation works like a notebook. On the left, **Sources** lists every source with a tick box: only ticked
sources go to the AI, and when the set changes the summary offers *Update summary*. Clicking a source opens its
preview and text, where you can fix misread words or quote a passage. On the right, the summary sits above the
chat. On phones the two columns become tabs.

**Add sources** offers *Upload files* (several at once, or a .zip — each document inside becomes a source),
*Google Drive*, *OneDrive* and *Paste text*. Drive and OneDrive appear only when their settings are present.
Files are read one after another, each with its own progress bar. A conversation holds up to 25 sources.

## What it reads

| Family | Formats | How |
| --- | --- | --- |
| Images | PNG, JPEG, WebP, HEIC/HEIF, TIFF (every page), GIF, BMP, AVIF, SVG | On-device OCR (tesseract.js), or Gemini vision |
| PDF | Digital and scanned | pdf.js text layer; scanned pages are OCR'd (up to 40) |
| Office & OpenDocument | DOCX, PPTX, XLSX, ODT, ODP, ODS, EPUB, RTF | Unzipped and parsed in the browser |
| Text & web | TXT, Markdown, CSV, JSON, HTML, XML, YAML | Read directly |
| Archives | ZIP | Unpacked in the browser; each file inside is read as above |
| Google Drive | Google Docs, Sheets, Slides and any file above | Docs, Sheets and Slides are exported as DOCX, XLSX and PPTX |

**Reading** has three modes: *Auto* (on-device, with the AI re-reading only low-confidence images),
*On-device* (the file never leaves the browser) and *AI vision* (best for handwriting and messy scans).
Only the extracted text is sent for analysis, unless AI vision is chosen.

**Voice input** uses the browser's own speech recognition (Chrome, Edge, Safari). Other browsers record and send
the audio to Gemini for transcription, which needs a sign-in.

## Stack

React 19 + TypeScript + Vite 8, Vercel functions in `api/` (Web-standard handlers), Google Identity Services
sign-in with an HttpOnly JWT session cookie (`jose`), Gemini via `@google/genai`, tesseract.js, pdf.js,
fflate, utif2, heic2any, and `@azure/msal-browser` (loaded only when someone opens OneDrive).

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the values; the file explains where each one comes from
npm run dev                  # http://localhost:3000 — the /api functions run inside the Vite dev server
```

With no `.env.local` at all, reading files still works (*Upload a document*); sign-in and the AI stay off until
`GOOGLE_CLIENT_ID` and `GEMINI_API_KEY` are set. `SESSION_SECRET` is optional in dev and required in production.
Google Drive needs `GOOGLE_API_KEY` and `GOOGLE_APP_ID` as well; OneDrive needs `MICROSOFT_CLIENT_ID`.

## Checks

```bash
npm run typecheck            # browser, server and config TypeScript projects
npm test                     # unit tests (vitest)
npm run lint                 # oxlint
npm run build && npm run test:e2e   # real browser run of the production build
```

The end-to-end run mocks the `/api` routes (signed-in user, analysis, chat), so it needs no keys. It reads every
file type, several files at once, a .zip and pasted text; checks citations, quoting, the summary going out of date,
the signed-out path and phone layouts. On-device OCR downloads its engine and language data from jsDelivr the
first time, so it does need a network connection. The Drive and OneDrive pickers need real accounts and are not
covered by it.

## Deploy (Vercel)

Import the repository; Vite is detected and `vercel.json` sets the function timeouts and security headers.
Add `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY` and `SESSION_SECRET` (optionally `GEMINI_MODEL`, `GOOGLE_API_KEY`,
`GOOGLE_APP_ID` and `MICROSOFT_CLIENT_ID`) under Project → Settings → Environment Variables, and add the
production URL to the OAuth client's *Authorized JavaScript origins*. For OneDrive, also add
`https://<your-domain>/auth/microsoft.html` as a *Single-page application* redirect URI in the Azure app
registration.
