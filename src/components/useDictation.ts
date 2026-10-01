import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_RECORDING_SECONDS } from '../../shared/limits';
import { errorMessage, isAbortError, transcribeRecording } from '../lib/api';

/** The part of the Web Speech API used here (TypeScript's DOM types only declare its events). */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  const w = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function canRecord(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

/** Recording formats Gemini accepts, best first. Firefox records Ogg, Chrome WebM, Safari MP4. */
const RECORDING_TYPES = ['audio/ogg;codecs=opus', 'audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];

const MIC_BLOCKED = 'Microphone access is blocked. Allow it in the browser’s site settings, then try again.';
const NO_MIC = 'No microphone was found.';
const NOT_HEARD = 'Nothing was heard. Try again a little closer to the microphone.';
const DICTATION_FAILED = 'Voice input stopped working. Try again, or type instead.';
const TRANSCRIBE_FAILED = "Couldn't turn the recording into text. Try again, or type instead.";

export type DictationStatus = 'idle' | 'listening' | 'transcribing';

interface DictationOptions {
  /** The words heard in this session so far; `final` once nothing more will come. */
  onText(text: string, final: boolean): void;
  /** Recordings may be sent for transcription (needs a sign-in and the AI). */
  canTranscribe: boolean;
}

/**
 * Voice input for the chat box. Uses the browser's own speech recognition where there is one (Chrome, Edge,
 * Safari); elsewhere it records and asks the server to transcribe, when that's allowed.
 */
export function useDictation({ onText, canTranscribe }: DictationOptions) {
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const transcription = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const onTextRef = useRef(onText);
  // Event handlers outlive renders, so they read the latest callback through a ref.
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const engine = recognitionConstructor() ? 'speech' : canRecord() && canTranscribe ? 'recorder' : null;

  const clearTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const listen = useCallback((Constructor: RecognitionConstructor) => {
    const rec = new Constructor();
    rec.lang = navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    rec.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      onTextRef.current(finalText + interim, false);
    };
    rec.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') setError(MIC_BLOCKED);
      else if (event.error === 'audio-capture') setError(NO_MIC);
      else if (event.error === 'no-speech') setError(NOT_HEARD);
      else setError(DICTATION_FAILED);
    };
    rec.onend = () => {
      recognition.current = null;
      setStatus('idle');
      onTextRef.current(finalText, true);
    };
    recognition.current = rec;
    rec.start();
    setStatus('listening');
  }, []);

  const record = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      setError(err instanceof DOMException && err.name === 'NotFoundError' ? NO_MIC : MIC_BLOCKED);
      return;
    }
    const mimeType = RECORDING_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
    const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    rec.onstop = async () => {
      clearTimer();
      stream.getTracks().forEach((track) => track.stop());
      recorder.current = null;
      const audio = new Blob(chunks, { type: rec.mimeType || mimeType || 'audio/webm' });
      if (audio.size === 0) {
        setStatus('idle');
        return;
      }
      const controller = new AbortController();
      transcription.current = controller;
      setStatus('transcribing');
      try {
        const text = await transcribeRecording(audio, controller.signal);
        if (text.trim()) onTextRef.current(text.trim(), true);
        else setError(NOT_HEARD);
      } catch (err) {
        if (!isAbortError(err)) setError(errorMessage(err, TRANSCRIBE_FAILED));
      } finally {
        if (transcription.current === controller) transcription.current = null;
        setStatus('idle');
      }
    };
    recorder.current = rec;
    rec.start();
    setStatus('listening');
    timer.current = window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), MAX_RECORDING_SECONDS * 1000);
  }, []);

  const start = useCallback(() => {
    setError(null);
    const Constructor = recognitionConstructor();
    if (Constructor) listen(Constructor);
    else if (engine === 'recorder') void record();
  }, [engine, listen, record]);

  /** Stops listening; what was heard so far is kept (and, for recordings, transcribed). */
  const stop = useCallback(() => {
    recognition.current?.stop();
    if (recorder.current && recorder.current.state !== 'inactive') recorder.current.stop();
  }, []);

  useEffect(
    () => () => {
      clearTimer();
      recognition.current?.abort();
      transcription.current?.abort();
      const rec = recorder.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
        rec.stream.getTracks().forEach((track) => track.stop());
      }
    },
    [],
  );

  return { available: engine !== null, status, error, start, stop, clearError: () => setError(null) };
}
