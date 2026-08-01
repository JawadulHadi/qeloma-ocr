/**
 * QelomaOCR — the extraction engine.
 *
 * Three modes, one result shape:
 *   'local'  — Tesseract.js WASM, runs entirely in the browser. Free, private,
 *              offline, zero per-page cost. The default.
 *   'ai'     — Gemini vision (BYO key). Handles handwriting, tables, messy scans,
 *              and understands layout. Cost falls on the user's own key.
 *   'hybrid' — local first; if mean confidence is below a threshold, escalate to
 *              AI (only if a key is present). Cheapest accurate path.
 *
 * The engine NEVER fabricates. Local mode reports exactly what Tesseract saw,
 * with per-word confidence. If AI is unavailable in hybrid mode, it returns the
 * local result and says so — it does not invent a "smarter" answer.
 */
import { createWorker, type Worker } from 'tesseract.js';
import { GoogleGenAI } from '@google/genai';

export type OcrMode = 'local' | 'ai' | 'hybrid';
export type SourceMethod = 'local' | 'ai' | 'local+ai';

export interface OcrWord {
  text: string;
  confidence: number; // 0..100
}

export interface OcrResult {
  text: string;
  words: OcrWord[];
  meanConfidence: number; // 0..100
  mode: OcrMode;
  source: SourceMethod;
  /** Set when hybrid wanted to escalate but no key was available. */
  note?: string;
  /** Structured fields, only populated by the AI pass when asked. */
  fields?: Record<string, string>;
}

const HYBRID_ESCALATE_BELOW = 75; // mean confidence under this triggers the AI pass

// ---- Local (Tesseract.js) ---------------------------------------------------

let workerPromise: Promise<Worker> | null = null;
async function getWorker(lang: string): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker(lang);
  }
  return workerPromise;
}

export async function runLocal(
  image: File | string,
  lang = 'eng'
): Promise<OcrResult> {
  const worker = await getWorker(lang);
  const { data } = await worker.recognize(image);
  const words: OcrWord[] = (data.words ?? []).map((w) => ({
    text: w.text,
    confidence: Math.round(w.confidence),
  }));
  return {
    text: data.text.trim(),
    words,
    meanConfidence: Math.round(data.confidence),
    mode: 'local',
    source: 'local',
  };
}

// ---- AI (Gemini vision, BYO key) -------------------------------------------

async function fileToBase64(file: File): Promise<{ data: string; mimeType: string }> {
  const buf = await file.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return { data: btoa(binary), mimeType: file.type || 'image/png' };
}

export interface AiOptions {
  apiKey: string;
  /** Ask the model to also pull structured fields (invoice-style). */
  extractFields?: boolean;
  model?: string;
}

export async function runAi(file: File, opts: AiOptions): Promise<OcrResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const { data, mimeType } = await fileToBase64(file);

  const instruction = opts.extractFields
    ? `Transcribe ALL text in this image exactly. Then, if it is a structured document
       (invoice, receipt, form, table), extract key fields. Respond as strict JSON:
       {"text": "<full transcription>", "fields": {"<label>": "<value>", ...}}.
       If you cannot read something, write "[illegible]" — never guess. No prose, JSON only.`
    : `Transcribe ALL text in this image exactly as written, preserving line breaks.
       If something is illegible, write "[illegible]" — never guess. Return only the text.`;

  const resp = await ai.models.generateContent({
    model: opts.model ?? 'gemini-2.5-flash',
    contents: [
      { role: 'user', parts: [
        { inlineData: { data, mimeType } },
        { text: instruction },
      ]},
    ],
  });

  const raw = resp.text ?? '';
  let text = raw.trim();
  let fields: Record<string, string> | undefined;

  if (opts.extractFields) {
    try {
      const json = JSON.parse(raw.replace(/```json|```/g, '').trim());
      text = (json.text ?? '').trim();
      fields = json.fields ?? undefined;
    } catch {
      // Model didn't return clean JSON — keep the raw text, no invented fields.
      text = raw.trim();
    }
  }

  return {
    text,
    words: [], // the vision model doesn't return per-word boxes here
    meanConfidence: 0, // not applicable to the AI transcription path
    mode: 'ai',
    source: 'ai',
    fields,
  };
}

// ---- Hybrid ----------------------------------------------------------------

export interface HybridOptions {
  apiKey?: string;
  extractFields?: boolean;
  lang?: string;
}

export async function runHybrid(file: File, opts: HybridOptions): Promise<OcrResult> {
  const local = await runLocal(file, opts.lang ?? 'eng');

  // Good enough locally, or no key to escalate → return the honest local result.
  if (local.meanConfidence >= HYBRID_ESCALATE_BELOW) {
    return { ...local, mode: 'hybrid', note: 'Local read was confident; no AI pass needed.' };
  }
  if (!opts.apiKey) {
    return {
      ...local,
      mode: 'hybrid',
      note: `Local confidence was ${local.meanConfidence}%. Add a Gemini key to escalate low-confidence scans.`,
    };
  }

  // Escalate to AI, but keep the local result's confidence signal for transparency.
  const ai = await runAi(file, { apiKey: opts.apiKey, extractFields: opts.extractFields });
  return {
    ...ai,
    mode: 'hybrid',
    source: 'local+ai',
    note: `Local confidence was ${local.meanConfidence}% — escalated to AI for a cleaner read.`,
  };
}

// ---- Unified entry ----------------------------------------------------------

export interface RunOptions {
  mode: OcrMode;
  apiKey?: string;
  extractFields?: boolean;
  lang?: string;
}

export async function runOcr(file: File, opts: RunOptions): Promise<OcrResult> {
  switch (opts.mode) {
    case 'local':
      return runLocal(file, opts.lang ?? 'eng');
    case 'ai':
      if (!opts.apiKey) throw new Error('AI mode needs a Gemini API key.');
      return runAi(file, { apiKey: opts.apiKey, extractFields: opts.extractFields });
    case 'hybrid':
      return runHybrid(file, {
        apiKey: opts.apiKey,
        extractFields: opts.extractFields,
        lang: opts.lang,
      });
  }
}

export async function disposeOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}
