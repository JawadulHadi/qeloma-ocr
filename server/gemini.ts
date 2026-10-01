import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  type Content,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type HttpRetryOptions,
} from '@google/genai';
import { stripUnknownCitations } from '../shared/citations.js';
import type { Analysis } from '../shared/types.js';
import { geminiModel, requireGeminiApiKey } from './env.js';
import { HttpError } from './http.js';
import {
  ANALYSIS_SCHEMA,
  ANALYSIS_SYSTEM_INSTRUCTION,
  NO_TEXT_MARKER,
  buildAnalysisPrompt,
  buildChatContext,
  buildChatSystemInstruction,
  buildVisionPrompt,
  NO_SPEECH_MARKER,
  TRANSCRIBE_PROMPT,
} from './prompts.js';
import { normalizeAnalysis, type ValidChatRequest, type ValidSource } from './validate.js';

type GeminiModels = Pick<GoogleGenAI['models'], 'generateContent' | 'generateContentStream'>;

// Transient Google-side failures get one quick retry; 429s don't, since retrying only deepens a rate limit.
const RETRY: HttpRetryOptions = { attempts: 2, initialDelay: 1, maxDelay: 2, httpStatusCodes: [500, 502, 503, 504] };

let client: { apiKey: string; models: GeminiModels } | null = null;

function models(): GeminiModels {
  const apiKey = requireGeminiApiKey();
  if (client?.apiKey !== apiKey) {
    client = { apiKey, models: new GoogleGenAI({ apiKey, httpOptions: { retryOptions: RETRY } }).models };
  }
  return client.models;
}

// ---- Errors --------------------------------------------------------------------

const BLOCKING_FINISH_REASONS: ReadonlySet<string> = new Set([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
  FinishReason.IMAGE_SAFETY,
  FinishReason.IMAGE_PROHIBITED_CONTENT,
]);

/** Maps SDK and network failures to API errors; HttpErrors pass through unchanged. */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof ApiError && err.status === 429) {
    return new HttpError(429, 'rate_limited', 'The AI is busy right now. Try again in a minute.', { cause: err });
  }
  return new HttpError(502, 'ai_unavailable', "The AI couldn't respond. Try again.", { cause: err });
}

function assertNotBlocked(response: GenerateContentResponse): void {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (response.promptFeedback?.blockReason || (finishReason && BLOCKING_FINISH_REASONS.has(finishReason))) {
    throw new HttpError(422, 'blocked', 'The AI declined to process this content.');
  }
}

// ---- Response helpers ----------------------------------------------------------

/** Answer text of the first candidate, without thought parts (read directly to avoid the SDK's console warnings). */
function candidateText(response: GenerateContentResponse): string {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  return parts.map((part) => (part.thought || typeof part.text !== 'string' ? '' : part.text)).join('');
}

function stripCodeFence(text: string): string {
  const fenced = /^\s*```[\w-]*\r?\n([\s\S]*?)\r?\n?```\s*$/.exec(text);
  return (fenced ? fenced[1] : text).trim();
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(stripCodeFence(text));
  } catch {
    return null;
  }
}

async function generate(params: GenerateContentParameters): Promise<GenerateContentResponse> {
  let response: GenerateContentResponse;
  try {
    response = await models().generateContent(params);
  } catch (err) {
    throw toHttpError(err);
  }
  assertNotBlocked(response);
  return response;
}

/**
 * Keeps citations only where they belong and only of sources that exist: names and titles carry none, and a
 * label the model made up ("[S9]" with three sources) is dropped rather than shown as a dead chip.
 */
export function cleanCitations(analysis: Analysis, labels: readonly string[]): Analysis {
  const known = new Set(labels);
  const none = new Set<string>();
  const cite = (text: string) => stripUnknownCitations(text, known);
  const plain = (text: string) => stripUnknownCitations(text, none).trim();
  return {
    title: plain(analysis.title) || analysis.title,
    documentType: plain(analysis.documentType) || analysis.documentType,
    language: plain(analysis.language) || analysis.language,
    summary: cite(analysis.summary),
    keyFactors: analysis.keyFactors.map((factor) => ({ ...factor, label: plain(factor.label) || factor.label, detail: cite(factor.detail) })),
    keyPoints: analysis.keyPoints.map(cite),
    solutions: analysis.solutions.map((solution) => ({
      ...solution,
      title: plain(solution.title) || solution.title,
      description: cite(solution.description),
      steps: solution.steps.map(cite),
    })),
    openQuestions: analysis.openQuestions.map(cite),
    caveats: analysis.caveats.map(cite),
  };
}

// ---- Operations ----------------------------------------------------------------

export async function analyzeSources(sources: ValidSource[], opts: { signal?: AbortSignal } = {}): Promise<Analysis> {
  const params: GenerateContentParameters = {
    model: geminiModel(),
    contents: buildAnalysisPrompt(sources),
    config: {
      systemInstruction: ANALYSIS_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseJsonSchema: ANALYSIS_SCHEMA,
      abortSignal: opts.signal,
    },
  };
  // Structured output is reliable but not guaranteed; one retry absorbs the occasional malformed reply.
  for (let attempt = 0; attempt < 2; attempt++) {
    const analysis = normalizeAnalysis(parseJson(candidateText(await generate(params))), sources[0].document.fileName);
    if (analysis) {
      return cleanCitations(
        analysis,
        sources.map((source) => source.label),
      );
    }
  }
  throw new HttpError(502, 'ai_unavailable', "The AI's analysis came back incomplete. Try again.", {
    cause: 'Gemini returned an unusable analysis twice in a row.',
  });
}

/** Document context first, then the conversation, as alternating user/model turns. */
function chatContents(req: ValidChatRequest): Content[] {
  const turns: { role: 'user' | 'model'; text: string }[] = [
    { role: 'user', text: buildChatContext(req.sources, req.analysis) },
    ...req.history.map((turn) => ({ role: turn.role === 'assistant' ? ('model' as const) : ('user' as const), text: turn.content })),
    { role: 'user', text: req.question },
  ];
  const contents: Content[] = [];
  for (const turn of turns) {
    const previous = contents.at(-1);
    // Neighbouring turns from the same speaker (e.g. a question whose answer failed) share one Content.
    if (previous?.role === turn.role) previous.parts?.push({ text: turn.text });
    else contents.push({ role: turn.role, parts: [{ text: turn.text }] });
  }
  return contents;
}

/** Streams the answer's Markdown. Fails before the first chunk (never mid-way) when nothing usable comes back. */
export async function* streamChat(req: ValidChatRequest, opts: { signal?: AbortSignal } = {}): AsyncGenerator<string, void> {
  let stream: AsyncGenerator<GenerateContentResponse>;
  try {
    stream = await models().generateContentStream({
      model: geminiModel(),
      contents: chatContents(req),
      config: { systemInstruction: buildChatSystemInstruction(req.sources), abortSignal: opts.signal },
    });
  } catch (err) {
    throw toHttpError(err);
  }

  let answered = false;
  try {
    for await (const chunk of stream) {
      assertNotBlocked(chunk);
      const text = candidateText(chunk);
      if (text) {
        answered = true;
        yield text;
      }
    }
  } catch (err) {
    throw toHttpError(err);
  }
  if (!answered) throw new HttpError(502, 'ai_unavailable', 'The AI returned an empty answer. Try again.');
}

/** Transcribes the text in an image; '' when the image has none. */
export async function transcribeImage(
  image: string,
  mimeType: string,
  opts: { language?: string; signal?: AbortSignal } = {},
): Promise<string> {
  const response = await generate({
    model: geminiModel(),
    contents: [{ role: 'user', parts: [{ inlineData: { data: image, mimeType } }, { text: buildVisionPrompt(opts.language) }] }],
    config: { abortSignal: opts.signal },
  });
  const text = stripCodeFence(candidateText(response));
  return text === NO_TEXT_MARKER ? '' : text;
}

/** Transcribes dictated speech; '' when the recording has none. */
export async function transcribeAudio(audio: string, mimeType: string, opts: { signal?: AbortSignal } = {}): Promise<string> {
  const response = await generate({
    model: geminiModel(),
    contents: [{ role: 'user', parts: [{ inlineData: { data: audio, mimeType } }, { text: TRANSCRIBE_PROMPT }] }],
    config: { abortSignal: opts.signal },
  });
  const text = stripCodeFence(candidateText(response));
  return text === NO_SPEECH_MARKER ? '' : text;
}
