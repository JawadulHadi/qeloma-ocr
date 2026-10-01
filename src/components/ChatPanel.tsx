import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Mic, RotateCcw, Square, X } from 'lucide-react';
import { MAX_QUESTION_CHARS } from '../../shared/limits';
import { DEFAULT_QUOTE_QUESTION, QUOTE_RESERVE_CHARS, type WorkspaceState } from '../hooks/useConversation';
import { CITE_HREF_PREFIX, remarkCitations } from '../lib/remarkCitations';
import type { MessageQuote, StoredMessage } from '../lib/store';
import { CitationChip } from './Citations';
import { formatCount } from './format';
import { useDictation } from './useDictation';

const SUGGESTIONS = [
  'What should I do first?',
  'Are there any deadlines or amounts I must not miss?',
  'Explain this in simple terms',
  'What’s missing or unclear?',
];

const MULTI_SOURCE_SUGGESTIONS = [
  'What should I do first?',
  'Do these documents disagree anywhere?',
  'List every deadline and amount',
  'What’s missing or unclear?',
];

interface ChatPanelProps {
  messages: StoredMessage[];
  chat: WorkspaceState['chat'];
  /** How many sources the answers draw on. */
  sourceCount: number;
  /** A passage waiting to be sent with the next question. */
  quote: MessageQuote | null;
  /** Changes whenever the composer should take focus (a passage was just quoted). */
  focusRequest: number;
  /** Voice input may fall back to server transcription. */
  canTranscribe: boolean;
  onAsk(question: string, quote?: MessageQuote): void;
  onClearQuote(): void;
  onStop(): void;
}

interface PendingQuestion {
  text: string;
  askedAt: number;
}

/**
 * The follow-up thread and its composer. Returns two siblings so the composer can stick to the bottom of the
 * whole analysis column, not just this section.
 */
export function ChatPanel({
  messages,
  chat,
  sourceCount,
  quote,
  focusRequest,
  canTranscribe,
  onAsk,
  onClearQuote,
  onStop,
}: ChatPanelProps) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const following = useRef(false);
  /** What was in the box when dictation started; dictated words are added after it. */
  const dictationBase = useRef('');
  /** False once the question was sent, so words that arrive late don't refill the emptied box. */
  const dictating = useRef(false);
  const maxLength = quote ? MAX_QUESTION_CHARS - QUOTE_RESERVE_CHARS : MAX_QUESTION_CHARS;
  const countFrom = Math.floor(maxLength * 0.9);
  const dictation = useDictation({
    canTranscribe,
    onText: (text, final) => {
      if (!dictating.current) return;
      const base = dictationBase.current;
      setQuestion(`${base}${base && text && !/\s$/.test(base) ? ' ' : ''}${text}`.slice(0, maxLength));
      if (final) dictating.current = false;
    },
  });
  const listening = dictation.status === 'listening';

  // The question is shown from here until the stored thread contains it, whenever the controller appends it.
  const showPending =
    pending !== null &&
    !messages.some(
      (message) => message.role === 'user' && message.content === pending.text && message.createdAt >= pending.askedAt,
    );
  const lastQuestion = pending?.text ?? messages.findLast((message) => message.role === 'user')?.content ?? null;
  const empty = messages.length === 0 && !showPending && !chat.streaming;

  useEffect(() => {
    const end = endRef.current;
    if (!end) return;
    const observer = new IntersectionObserver(([entry]) => {
      following.current = entry.isIntersecting;
    });
    observer.observe(end);
    return () => observer.disconnect();
  }, []);

  // Keep the newest text in view while the reader is at the end of the thread; leave them alone if they scrolled up.
  useLayoutEffect(() => {
    const end = endRef.current;
    if (!end || !following.current) return;
    const container = scrollContainerOf(end);
    container.scrollTo({ top: container.scrollHeight, behavior: 'instant' });
  }, [messages.length, chat.draft, chat.streaming, chat.error, showPending]);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight + input.offsetHeight - input.clientHeight}px`;
  }, [question]);

  useEffect(() => {
    if (focusRequest > 0) inputRef.current?.focus();
  }, [focusRequest]);

  const ask = (raw: string, withQuote?: MessageQuote): boolean => {
    const text = raw.trim() || (withQuote ? DEFAULT_QUOTE_QUESTION : '');
    if (!text || chat.streaming) return false;
    setPending({ text, askedAt: Date.now() });
    following.current = true;
    onAsk(text, withQuote);
    return true;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (dictation.status !== 'idle') {
      dictating.current = false;
      dictation.stop();
    }
    if (ask(question, quote ?? undefined)) {
      setQuestion('');
      onClearQuote();
    }
  };

  const toggleDictation = () => {
    if (listening) {
      dictation.stop();
      return;
    }
    dictationBase.current = question;
    dictating.current = true;
    dictation.start();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <>
      <section className="chat" aria-labelledby="chat-title">
        <h2 id="chat-title" className="chat-title">
          {sourceCount > 1 ? `Ask about these ${sourceCount} sources` : 'Ask about this document'}
        </h2>

        {empty && (
          <div className="suggestions">
            <p className="chat-hint">
              Answers come from the ticked sources and show which one they used. Start with one of these:
            </p>
            <ul className="suggestion-list">
              {(sourceCount > 1 ? MULTI_SOURCE_SUGGESTIONS : SUGGESTIONS).map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" className="suggestion" onClick={() => ask(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <ol className="chat-list" aria-label="Questions and answers" aria-live="polite" aria-busy={chat.streaming}>
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
          {showPending && (
            <li className="msg msg-user">
              <span className="visually-hidden">You asked: </span>
              <p className="msg-text" dir="auto">
                {pending.text}
              </p>
            </li>
          )}
          {chat.streaming && (
            <li className="msg msg-assistant">
              <span className="visually-hidden">Scanwise is answering: </span>
              {chat.draft ? (
                <div className="md is-streaming" dir="auto">
                  <AssistantMarkdown text={chat.draft} />
                </div>
              ) : (
                <span className="caret" aria-hidden="true" />
              )}
            </li>
          )}
        </ol>

        {chat.error && !chat.streaming && (
          <div className="chat-error" role="alert">
            <p>{chat.error}</p>
            {lastQuestion && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => ask(lastQuestion, messages.findLast((message) => message.role === 'user')?.quote)}
              >
                <RotateCcw size={16} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={endRef} className="chat-end" aria-hidden="true" />
      </section>

      <form className="composer" onSubmit={submit}>
        {quote && (
          <div className="composer-quote">
            <QuoteBlock quote={quote} />
            <button type="button" className="icon-btn" aria-label="Remove the quoted passage" onClick={onClearQuote}>
              <X aria-hidden="true" />
            </button>
          </div>
        )}
        <label htmlFor="chat-question" className="visually-hidden">
          {quote ? 'Say what you want to know about the quoted passage' : 'Ask a question about the sources'}
        </label>
        <textarea
          ref={inputRef}
          id="chat-question"
          className="field composer-input"
          rows={1}
          value={question}
          placeholder={listening ? 'Listening…' : quote ? 'What do you want to know about this passage?' : 'Ask a follow-up question'}
          maxLength={maxLength}
          dir="auto"
          readOnly={dictation.status === 'transcribing'}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        {dictation.error && (
          <p className="composer-error" role="alert">
            {dictation.error}
          </p>
        )}
        <div className="composer-actions">
          {question.length >= countFrom && (
            <span className="composer-count">
              {formatCount(question.length)} / {formatCount(maxLength)}
            </span>
          )}
          {dictation.status === 'transcribing' && <span className="composer-count">Turning speech into text…</span>}
          {dictation.available && (
            <button
              type="button"
              className={listening ? 'icon-btn composer-mic is-listening' : 'icon-btn composer-mic'}
              aria-label={listening ? 'Stop voice input' : 'Speak your question'}
              aria-pressed={listening}
              disabled={dictation.status === 'transcribing'}
              onClick={toggleDictation}
            >
              {listening ? <Square size={14} aria-hidden="true" /> : <Mic size={18} aria-hidden="true" />}
            </button>
          )}
          {chat.streaming && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
              <Square size={14} aria-hidden="true" />
              Stop
            </button>
          )}
          <button
            type="submit"
            className="icon-btn composer-send"
            aria-label="Send question"
            disabled={(question.trim().length === 0 && !quote) || chat.streaming}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
      </form>
    </>
  );
}

/** A quoted passage with the chip of the source it came from. */
function QuoteBlock({ quote }: { quote: MessageQuote }) {
  return (
    <figure className="quote">
      <blockquote className="quote-text" dir="auto">
        {quote.text}
      </blockquote>
      <figcaption className="quote-source">
        <CitationChip label={quote.label} />
      </figcaption>
    </figure>
  );
}

const ChatMessage = memo(function ChatMessage({ message }: { message: StoredMessage }) {
  if (message.role === 'user') {
    return (
      <li className="msg msg-user">
        <span className="visually-hidden">You asked: </span>
        {message.quote && <QuoteBlock quote={message.quote} />}
        <p className="msg-text" dir="auto">
          {message.content}
        </p>
      </li>
    );
  }
  return (
    <li className="msg msg-assistant">
      <span className="visually-hidden">Scanwise answered: </span>
      {message.content && (
        <div className="md" dir="auto">
          <AssistantMarkdown text={message.content} />
        </div>
      )}
      {message.error && <p className="msg-error">{message.error}</p>}
    </li>
  );
});

const REMARK_PLUGINS = [remarkGfm, remarkCitations];
// Images are dropped so an answer can never make the browser fetch a URL on its own.
const DISALLOWED_ELEMENTS = ['img'];
const MARKDOWN_COMPONENTS: Components = { a: ExternalLink, table: ScrollableTable };

function AssistantMarkdown({ text }: { text: string }) {
  return (
    <Markdown
      remarkPlugins={REMARK_PLUGINS}
      components={MARKDOWN_COMPONENTS}
      disallowedElements={DISALLOWED_ELEMENTS}
      skipHtml
    >
      {text}
    </Markdown>
  );
}

function ExternalLink({ href, children }: ComponentPropsWithoutRef<'a'>) {
  if (href?.startsWith(CITE_HREF_PREFIX)) return <CitationChip label={href.slice(CITE_HREF_PREFIX.length)} />;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function ScrollableTable({ children }: ComponentPropsWithoutRef<'table'>) {
  return (
    <div className="md-table">
      <table>{children}</table>
    </div>
  );
}

/** The element that scrolls the thread: the analysis column on wide screens, the page on narrow ones. */
function scrollContainerOf(node: HTMLElement): Element {
  for (let element = node.parentElement; element; element = element.parentElement) {
    const { overflowY } = getComputedStyle(element);
    if ((overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight) {
      return element;
    }
  }
  return document.scrollingElement ?? document.documentElement;
}
