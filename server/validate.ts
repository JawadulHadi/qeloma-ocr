import { shareBudget } from '../shared/budget.js';
import {
  MAX_ANALYZE_CHARS,
  MAX_AUDIO_BASE64_CHARS,
  MAX_CHAT_HISTORY,
  MAX_CHAT_TURN_CHARS,
  MAX_QUESTION_CHARS,
  MAX_SOURCES,
  MAX_VISION_BASE64_CHARS,
} from '../shared/limits.js';
import type {
  Analysis,
  ChatTurn,
  DocumentMeta,
  FileKind,
  GoogleSignInRequest,
  Importance,
  KeyFactor,
  Solution,
  SourceInput,
  TranscribeRequest,
  VisionRequest,
} from '../shared/types.js';
import { HttpError } from './http.js';

function badRequest(message: string): HttpError {
  return new HttpError(400, 'bad_request', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Cuts `text` to at most `max` UTF-16 units without splitting a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const lastCode = text.charCodeAt(max - 1);
  return text.slice(0, lastCode >= 0xd800 && lastCode <= 0xdbff ? max - 1 : max);
}

/** Metadata ends up in prompts and headings, so it is flattened to one clean line. */
function singleLine(value: string, max: number): string {
  return truncate(value.replace(/\p{Cc}+/gu, ' ').replace(/\s+/g, ' ').trim(), max);
}

// ---- Requests ----------------------------------------------------------------

const JWT_SHAPE = /^[\w-]+\.[\w-]+\.[\w-]+$/;
const MAX_CREDENTIAL_CHARS = 8192;

export function validateGoogleSignIn(body: unknown): GoogleSignInRequest {
  const credential = isRecord(body) ? body.credential : undefined;
  if (typeof credential !== 'string' || credential.length > MAX_CREDENTIAL_CHARS || !JWT_SHAPE.test(credential)) {
    throw badRequest("Google didn't return a usable sign-in response. Try again.");
  }
  return { credential };
}

const FILE_KINDS: readonly string[] = ['image', 'pdf', 'office', 'text'] satisfies FileKind[];
const MAX_PAGE_COUNT = 100_000;

function isFileKind(value: unknown): value is FileKind {
  return typeof value === 'string' && FILE_KINDS.includes(value);
}

export function validateDocumentMeta(value: unknown): DocumentMeta {
  if (!isRecord(value)) throw badRequest('The document details are missing.');
  const { fileName, mimeType, kind, pageCount, engine } = value;
  const meanConfidence = value.meanConfidence ?? null;

  if (typeof fileName !== 'string') throw badRequest("The document's file name is missing.");
  if (typeof mimeType !== 'string') throw badRequest("The document's file type is missing.");
  if (!isFileKind(kind)) throw badRequest("The document's kind must be image, pdf, office or text.");
  if (typeof pageCount !== 'number' || !Number.isInteger(pageCount) || pageCount < 0 || pageCount > MAX_PAGE_COUNT) {
    throw badRequest("The document's page count isn't a valid number.");
  }
  if (
    meanConfidence !== null &&
    (typeof meanConfidence !== 'number' || !Number.isFinite(meanConfidence) || meanConfidence < 0 || meanConfidence > 100)
  ) {
    throw badRequest('The reading confidence must be a number from 0 to 100.');
  }
  if (typeof engine !== 'string') throw badRequest('How the text was read is missing from the document details.');

  return {
    fileName: singleLine(fileName, 255) || 'Untitled document',
    mimeType: singleLine(mimeType, 127),
    kind,
    pageCount,
    meanConfidence,
    engine: singleLine(engine, 80),
  };
}

const SOURCE_LABEL = /^S[1-9]\d{0,3}$/;

/** A source after validation. `truncated` is set when its text was cut to fit the shared budget. */
export interface ValidSource extends SourceInput {
  truncated: boolean;
}

/**
 * Sources without text are dropped: there is nothing to read or cite. Text beyond MAX_ANALYZE_CHARS in total is
 * cut and flagged rather than rejected, and shared out so every source keeps a fair part.
 */
export function validateSources(value: unknown, emptyMessage: string): ValidSource[] {
  if (!Array.isArray(value) || value.length === 0) throw badRequest(emptyMessage);
  if (value.length > MAX_SOURCES) throw badRequest(`Use at most ${MAX_SOURCES} sources at a time.`);
  const seen = new Set<string>();
  const sources = value.flatMap((entry: unknown): SourceInput[] => {
    if (!isRecord(entry)) throw badRequest('Each source needs a label, its text and its details.');
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    if (!SOURCE_LABEL.test(label)) throw badRequest('Each source label must look like S1, S2, S3…');
    if (seen.has(label)) throw badRequest(`Two sources share the label ${label}.`);
    seen.add(label);
    const document = validateDocumentMeta(entry.document);
    const text = typeof entry.text === 'string' ? entry.text.trim() : '';
    return text ? [{ label, text, document }] : [];
  });
  if (sources.length === 0) throw badRequest(emptyMessage);
  const allowed = shareBudget(
    sources.map((source) => source.text.length),
    MAX_ANALYZE_CHARS,
  );
  return sources.map((source, index) =>
    source.text.length > allowed[index]
      ? { ...source, text: truncate(source.text, allowed[index]), truncated: true }
      : { ...source, truncated: false },
  );
}

export interface ValidAnalyzeRequest {
  sources: ValidSource[];
}

export function validateAnalyzeRequest(body: unknown): ValidAnalyzeRequest {
  const record = isRecord(body) ? body : {};
  return { sources: validateSources(record.sources, "There's no text to analyze.") };
}

function validateHistory(value: unknown): ChatTurn[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('The chat history must be a list of messages.');
  return value.slice(-MAX_CHAT_HISTORY).flatMap((turn: unknown): ChatTurn[] => {
    if (!isRecord(turn) || (turn.role !== 'user' && turn.role !== 'assistant') || typeof turn.content !== 'string') {
      throw badRequest('Each earlier chat message needs a role (user or assistant) and text.');
    }
    const content = truncate(turn.content.trim(), MAX_CHAT_TURN_CHARS);
    return content ? [{ role: turn.role, content }] : [];
  });
}

export interface ValidChatRequest {
  sources: ValidSource[];
  analysis: Analysis | null;
  history: ChatTurn[];
  question: string;
}

export function validateChatRequest(body: unknown): ValidChatRequest {
  const record = isRecord(body) ? body : {};
  const question = typeof record.question === 'string' ? record.question.trim() : '';
  if (!question) throw badRequest('Type a question first.');
  if (question.length > MAX_QUESTION_CHARS) {
    throw badRequest(`Your question is too long. Keep it under ${MAX_QUESTION_CHARS.toLocaleString('en-US')} characters.`);
  }
  return {
    sources: validateSources(record.sources, 'Choose at least one source with text to ask about.'),
    // A stale or malformed analysis only loses chat some context; it shouldn't block the question.
    analysis: record.analysis == null ? null : normalizeAnalysis(record.analysis),
    history: validateHistory(record.history),
    question,
  };
}

export const IMAGE_TOO_LARGE_MESSAGE = 'This image is too large for AI reading. Try a smaller image.';

const VISION_MIME_TYPES: readonly string[] = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const LANGUAGE_HINT = /^[A-Za-z_]{2,20}(?:\+[A-Za-z_]{2,20}){0,7}$/;

export function validateVisionRequest(body: unknown): VisionRequest {
  const record = isRecord(body) ? body : {};
  const { image } = record;
  if (typeof image !== 'string' || !image) throw badRequest('The image is missing.');
  if (image.length > MAX_VISION_BASE64_CHARS) {
    throw new HttpError(413, 'payload_too_large', IMAGE_TOO_LARGE_MESSAGE);
  }
  if (image.length % 4 !== 0 || !BASE64.test(image)) {
    throw badRequest("The image data isn't valid base64. Send the bytes without a data: prefix.");
  }

  const mimeType = typeof record.mimeType === 'string' ? record.mimeType.trim().toLowerCase() : '';
  if (!VISION_MIME_TYPES.includes(mimeType)) throw badRequest('AI reading supports PNG, JPEG, WebP and HEIC images.');

  const rawLanguage = record.language ?? '';
  const language = typeof rawLanguage === 'string' ? rawLanguage.trim() : null;
  if (language === null || (language && !LANGUAGE_HINT.test(language))) {
    throw badRequest('The language hint must be a code like "eng" or "eng+urd".');
  }
  return language ? { image, mimeType, language } : { image, mimeType };
}

export const AUDIO_TOO_LARGE_MESSAGE = 'This recording is too long to transcribe. Keep it under two minutes.';

/** Formats browsers record in (MediaRecorder) that Gemini accepts. */
const AUDIO_MIME_TYPES: readonly string[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/aac',
  'audio/wav',
  'audio/flac',
];

export function validateTranscribeRequest(body: unknown): TranscribeRequest {
  const record = isRecord(body) ? body : {};
  const { audio } = record;
  if (typeof audio !== 'string' || !audio) throw badRequest('The recording is missing.');
  if (audio.length > MAX_AUDIO_BASE64_CHARS) throw new HttpError(413, 'payload_too_large', AUDIO_TOO_LARGE_MESSAGE);
  if (audio.length % 4 !== 0 || !BASE64.test(audio)) {
    throw badRequest("The recording isn't valid base64. Send the bytes without a data: prefix.");
  }
  // "audio/webm;codecs=opus" → "audio/webm": the codec lives in the container, and Gemini wants the bare type.
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType.split(';')[0].trim().toLowerCase() : '';
  if (!AUDIO_MIME_TYPES.includes(mimeType)) throw badRequest("This browser's recording format isn't supported.");
  return { audio, mimeType };
}

// ---- Analysis (model output, or an analysis echoed back by the browser) -------

export const ANALYSIS_LIMITS = {
  keyFactors: 8,
  keyPoints: 10,
  solutions: 6,
  steps: 8,
  openQuestions: 6,
  caveats: 6,
} as const;

const IMPORTANCE: readonly string[] = ['high', 'medium', 'low'] satisfies Importance[];

function isImportance(value: string): value is Importance {
  return IMPORTANCE.includes(value);
}

/** A trimmed, length-capped string; '' for anything that isn't a string. */
function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > max ? `${truncate(text, max - 1).trimEnd()}…` : text;
}

function cleanList<T>(value: unknown, max: number, item: (entry: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const entry of value) {
    const cleaned = item(entry);
    if (cleaned !== null) items.push(cleaned);
    if (items.length === max) break;
  }
  return items;
}

function cleanTextList(value: unknown, max: number, maxChars: number): string[] {
  return cleanList(value, max, (entry) => cleanText(entry, maxChars) || null);
}

function cleanKeyFactor(entry: unknown): KeyFactor | null {
  if (!isRecord(entry)) return null;
  const label = cleanText(entry.label, 160);
  const detail = cleanText(entry.detail, 1000);
  if (!label && !detail) return null;
  const importance = typeof entry.importance === 'string' ? entry.importance.trim().toLowerCase() : '';
  return { label: label || detail, detail, importance: isImportance(importance) ? importance : 'medium' };
}

function cleanSolution(entry: unknown): Solution | null {
  if (!isRecord(entry)) return null;
  const title = cleanText(entry.title, 160);
  const description = cleanText(entry.description, 1200);
  if (!title && !description) return null;
  const source = typeof entry.source === 'string' && entry.source.trim().toLowerCase() === 'document' ? 'document' : 'suggested';
  return {
    title: title || description,
    description,
    steps: cleanTextList(entry.steps, ANALYSIS_LIMITS.steps, 600),
    source,
  };
}

/**
 * Coerces untrusted analysis JSON into a well-formed Analysis: strings trimmed and capped, arrays
 * capped, enums defaulted. Returns null when it isn't an analysis at all (no object or no summary).
 */
export function normalizeAnalysis(value: unknown, fallbackTitle = 'Untitled document'): Analysis | null {
  if (!isRecord(value)) return null;
  const summary = cleanText(value.summary, 2000);
  if (!summary) return null;
  return {
    title: cleanText(value.title, 160) || fallbackTitle,
    documentType: cleanText(value.documentType, 80) || 'Document',
    language: cleanText(value.language, 60) || 'Unknown',
    summary,
    keyFactors: cleanList(value.keyFactors, ANALYSIS_LIMITS.keyFactors, cleanKeyFactor),
    keyPoints: cleanTextList(value.keyPoints, ANALYSIS_LIMITS.keyPoints, 600),
    solutions: cleanList(value.solutions, ANALYSIS_LIMITS.solutions, cleanSolution),
    openQuestions: cleanTextList(value.openQuestions, ANALYSIS_LIMITS.openQuestions, 600),
    caveats: cleanTextList(value.caveats, ANALYSIS_LIMITS.caveats, 600),
  };
}
