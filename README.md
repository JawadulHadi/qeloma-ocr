# Scanwise

Upload a document — a phone photo, a scan, a PDF, an Office file — and Scanwise tells you what it says and
what to do about it.

1. **Extract.** The text is read in your browser, with a confidence score for every word (green, amber, red).
2. **Understand.** Gemini turns the text into a summary, key factors, key points, open questions and caveats.
3. **Act.** Solutions are marked *in the document* or *suggested*. Ask follow-up questions in a chat grounded in
   the text, and export everything as Markdown.

No account is needed to read a file: *Upload a document* on the landing page reads it on your device. The AI
analysis, chat and AI vision need a Google sign-in; whatever was read before signing in moves into the account.
History is kept per Google account in the browser (IndexedDB); before sign-in it lasts only for the tab. There is
no server-side storage.

## What it reads

| Family | Formats | How |
| --- | --- | --- |
| Images | PNG, JPEG, WebP, HEIC/HEIF, TIFF (every page), GIF, BMP, AVIF, SVG | On-device OCR (tesseract.js), or Gemini vision |
| PDF | Digital and scanned | pdf.js text layer; scanned pages are OCR'd (up to 40) |
| Office & OpenDocument | DOCX, PPTX, XLSX, ODT, ODP, ODS, EPUB, RTF | Unzipped and parsed in the browser |
| Text & web | TXT, Markdown, CSV, JSON, HTML, XML, YAML | Read directly |

**Reading** has three modes: *Auto* (on-device, with the AI re-reading only low-confidence images),
*On-device* (the file never leaves the browser) and *AI vision* (best for handwriting and messy scans).
Only the extracted text is sent for analysis, unless AI vision is chosen.

## Stack

React 19 + TypeScript + Vite 8, Vercel functions in `api/` (Web-standard handlers), Google Identity Services
sign-in with an HttpOnly JWT session cookie (`jose`), Gemini via `@google/genai`, tesseract.js, pdf.js,
fflate, utif2, heic2any.

## Run locally

```bash
npm install
cp .env.example .env.local   # then fill in the values; the file explains where each one comes from
npm run dev                  # http://localhost:3000 — the /api functions run inside the Vite dev server
```

With no `.env.local` at all, reading files still works (*Upload a document*); sign-in and the AI stay off until
`GOOGLE_CLIENT_ID` and `GEMINI_API_KEY` are set. `SESSION_SECRET` is optional in dev and required in production.

## Checks

```bash
npm run typecheck            # browser, server and config TypeScript projects
npm test                     # unit tests (vitest)
npm run lint                 # oxlint
npm run build && npm run test:e2e   # real browser run of the production build over every file type
```

The end-to-end run mocks the `/api` routes (signed-in user, analysis, chat), so it needs no keys. On-device OCR
downloads its engine and language data from jsDelivr the first time, so it does need a network connection.

## Deploy (Vercel)

Import the repository; Vite is detected and `vercel.json` sets the function timeouts and security headers.
Add `GOOGLE_CLIENT_ID`, `GEMINI_API_KEY` and `SESSION_SECRET` (optionally `GEMINI_MODEL`) under
Project → Settings → Environment Variables, and add the production URL to the OAuth client's
*Authorized JavaScript origins*.
