# QelomaOCR

Read text from any image — and **see how sure the machine is**, word by word.
Part of the Qeloma suite. Runs on free tiers, with a genuinely private default path.

## Three modes, one honest result

| Mode | Engine | Best for | Cost |
|------|--------|----------|------|
| **Fast** | Tesseract.js (WASM, in-browser) | Clean printed docs, forms, invoices. Private + offline. | **Free** |
| **Smart** | Gemini vision (your key) | Handwriting, tables, messy scans, layout understanding. | Your Gemini key |
| **Auto** | Fast first → AI only if unclear | Cheapest accurate path. | Free unless it escalates |

The engine **never fabricates**. Fast mode reports exactly what Tesseract saw, with
per-word confidence. If a word is illegible in AI mode, it returns `[illegible]` rather
than guessing. In Auto mode, if confidence is low and no key is present, it says so
instead of inventing a "smarter" answer.

## The signature: confidence you can see
Every word is tinted by how confident the read is — green (high), amber (medium),
red + underline (low). You always know which parts to trust. Toggle to plain text to copy.

## Zero-cost by design
- **Fast mode** runs entirely in your browser via WebAssembly — no server, no API, no
  per-page cost, and your document never leaves the device.
- **Smart mode** uses **your own** Gemini API key (free-tier eligible). The key stays in
  your browser; it is never sent anywhere but Google.
- **Hosting:** static SPA on Vercel Hobby (free).

## Run locally
```bash
npm install
npm run dev
```

## Deploy (Vercel, free)
1. Import this folder as a Vercel project (framework auto-detects Vite).
2. Deploy. No env vars required — Fast mode works out of the box; users paste their own
   Gemini key in the UI for Smart/Auto.

## How it fits the suite
QelomaOCR's output is designed to feed **QelomaLens** — extract text here, then run
SUMMARIZE / EXTRACT_FACTS / VERDICT on it. OCR is the front door; Lens is the brain.

## Verified
- Tesseract.js proven headless (94% confidence on a test doc).
- Typecheck clean, production `vite build` succeeds.
- End-to-end in headless Chromium: upload → read → text + per-word confidence, light
  and dark themes, zero console errors.

## Stack
React 19 + TypeScript + Vite · tesseract.js (local) · @google/genai (AI) · Qeloma theming.
