/**
 * Contracts shared by the browser app (src/) and the Vercel functions (api/, server/).
 * Keep this file dependency-free: it is compiled by both tsconfig.app.json and tsconfig.api.json.
 */

// ---- Auth -------------------------------------------------------------------

export interface SessionUser {
  /** Google account subject id (stable per Google account). */
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

/** GET /api/auth/config */
export interface AuthConfig {
  /** OAuth web client id for Google Identity Services, or null when sign-in is not configured. */
  googleClientId: string | null;
  /** True when the server has a Gemini key and can analyze / chat / read images. */
  aiConfigured: boolean;
  /** The Gemini model id the server will use. */
  model: string;
}

/** POST /api/auth/google  body */
export interface GoogleSignInRequest {
  /** The ID token (JWT) returned by Google Identity Services. */
  credential: string;
}

/** POST /api/auth/google, GET /api/auth/me  response */
export interface SessionResponse {
  user: SessionUser;
}

// ---- Documents & extraction -----------------------------------------------

export type FileKind = 'image' | 'pdf' | 'office' | 'text';

/** Describes the uploaded document to the AI endpoints (never includes the file bytes). */
export interface DocumentMeta {
  fileName: string;
  mimeType: string;
  kind: FileKind;
  pageCount: number;
  /** Mean OCR confidence 0..100, or null when the text did not come from OCR. */
  meanConfidence: number | null;
  /** Human label of how the text was obtained, e.g. "On-device OCR", "PDF text layer". */
  engine: string;
}

// ---- Analysis ---------------------------------------------------------------

export type Importance = 'high' | 'medium' | 'low';

export interface KeyFactor {
  /** Short name of the factor, e.g. "Payment due date". */
  label: string;
  /** One or two sentences, grounded in the document. */
  detail: string;
  importance: Importance;
}

export interface Solution {
  title: string;
  description: string;
  /** Concrete, ordered steps the reader can take. */
  steps: string[];
  /** 'document' = an option/remedy the document itself offers; 'suggested' = the AI's recommendation. */
  source: 'document' | 'suggested';
}

export interface Analysis {
  /** Short human title for the document, e.g. "Electricity bill — September 2026". */
  title: string;
  /** e.g. "Invoice", "Lease agreement", "Lab report". */
  documentType: string;
  /** Language of the document, e.g. "English". */
  language: string;
  /** 2–4 sentence plain-language summary. */
  summary: string;
  keyFactors: KeyFactor[];
  keyPoints: string[];
  solutions: Solution[];
  /** Things the document leaves unanswered or the reader should verify. */
  openQuestions: string[];
  /** Reading caveats, e.g. low-confidence OCR regions or missing pages. */
  caveats: string[];
}

/** POST /api/analyze  body */
export interface AnalyzeRequest {
  text: string;
  document: DocumentMeta;
}

/** POST /api/analyze  response */
export interface AnalyzeResponse {
  analysis: Analysis;
  model: string;
  /** True when the server cut the text to MAX_ANALYZE_CHARS before analysis. */
  truncated: boolean;
}

// ---- Chat -------------------------------------------------------------------

export type ChatRole = 'user' | 'assistant';

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/**
 * POST /api/chat  body.
 * Response: `text/plain; charset=utf-8`, streamed in chunks (the assistant's Markdown answer).
 */
export interface ChatRequest {
  text: string;
  document: DocumentMeta;
  analysis: Analysis | null;
  /** Previous turns, oldest first, excluding `question`. */
  history: ChatTurn[];
  question: string;
}

// ---- Vision (AI re-read of an image or scanned page) ------------------------

/** POST /api/vision  body */
export interface VisionRequest {
  /** Base64 image bytes WITHOUT a `data:` prefix. */
  image: string;
  /** One of image/png, image/jpeg, image/webp, image/heic, image/heif. */
  mimeType: string;
  /** Tesseract-style language hint, e.g. "eng" or "eng+urd". */
  language?: string;
}

/** POST /api/vision  response */
export interface VisionResponse {
  text: string;
  model: string;
}

// ---- Errors -----------------------------------------------------------------

/** Every non-2xx JSON response from /api uses this shape. */
export interface ApiErrorBody {
  error: {
    /** Machine-readable, e.g. "unauthorized", "bad_request", "ai_unavailable", "rate_limited". */
    code: string;
    /** Sentence written for the end user. */
    message: string;
  };
}
