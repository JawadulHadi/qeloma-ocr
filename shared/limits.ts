/** Limits shared by the browser and the server so both sides reject the same things. */

/** Largest file a user can upload for extraction (processed in the browser). */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/** Most text the server analyzes or chats over, across all sources; longer text is truncated and flagged. */
export const MAX_ANALYZE_CHARS = 120_000;

/** Most sources in one conversation, and in one request. */
export const MAX_SOURCES = 25;

/** Most files taken from one ZIP archive. */
export const MAX_ZIP_ENTRIES = MAX_SOURCES;

/** Most bytes unpacked from one ZIP archive, so a small archive can't expand into gigabytes. */
export const MAX_ZIP_UNPACKED_BYTES = 200 * 1024 * 1024;

/** Longest passage quoted from a source into a chat question. */
export const MAX_QUOTE_CHARS = 1_500;

/** Longest single chat question. */
export const MAX_QUESTION_CHARS = 4_000;

/** Most previous chat turns sent with a question (oldest are dropped first). */
export const MAX_CHAT_HISTORY = 20;

/** Longest single chat turn kept in history sent to the server. */
export const MAX_CHAT_TURN_CHARS = 8_000;

/** Base64 length cap for /api/vision (≈3 MB of image bytes; Vercel bodies max out at 4.5 MB). */
export const MAX_VISION_BASE64_CHARS = 4_000_000;

/** Base64 length cap for /api/transcribe (≈3 MB of audio, far more than MAX_RECORDING_SECONDS needs). */
export const MAX_AUDIO_BASE64_CHARS = 4_000_000;

/** Longest voice recording sent for transcription. */
export const MAX_RECORDING_SECONDS = 120;

/** Longest edge, in pixels, of an image sent to /api/vision (the browser downsizes first). */
export const VISION_MAX_EDGE_PX = 2000;

/** Most scanned PDF pages OCR'd in one document (text-layer pages are not limited by this). */
export const MAX_OCR_PDF_PAGES = 40;

/** Most PDF pages read at all. */
export const MAX_PDF_PAGES = 300;

/** Mean OCR confidence below which Auto mode asks the AI to re-read an image or page. */
export const AUTO_ESCALATE_BELOW = 70;

/** Session lifetime. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

/** Keep the original file in local history only when it is at most this big. */
export const MAX_STORED_SOURCE_BYTES = 10 * 1024 * 1024;
