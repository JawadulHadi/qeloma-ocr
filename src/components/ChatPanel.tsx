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
import { ArrowUp, RotateCcw, Square } from 'lucide-react';
import { MAX_QUESTION_CHARS } from '../../shared/limits';
import type { WorkspaceState } from '../hooks/useConversation';
import type { StoredMessage } from '../lib/store';
import { formatCount } from './format';

const SUGGESTIONS = [
  'What should I do first?',
  'Are there any deadlines or amounts I must not miss?',
  'Explain this in simple terms',
  'What’s missing or unclear?',
];

/** Show the character count once a question gets close to the limit. */
const COUNT_FROM = Math.floor(MAX_QUESTION_CHARS * 0.9);

interface ChatPanelProps {
  messages: StoredMessage[];
  chat: WorkspaceState['chat'];
  onAsk(question: string): void;
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
export function ChatPanel({ messages, chat, onAsk, onStop }: ChatPanelProps) {
  const [question, setQuestion] = useState('');
  const [pending, setPending] = useState<PendingQuestion | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const following = useRef(false);

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

  const ask = (raw: string): boolean => {
    const text = raw.trim();
    if (!text || chat.streaming) return false;
    setPending({ text, askedAt: Date.now() });
    following.current = true;
    onAsk(text);
    return true;
  };

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (ask(question)) setQuestion('');
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
          Ask about this document
        </h2>

        {empty && (
          <div className="suggestions">
            <p className="chat-hint">Answers are based on the document’s text. Start with one of these:</p>
            <ul className="suggestion-list">
              {SUGGESTIONS.map((suggestion) => (
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => ask(lastQuestion)}>
                <RotateCcw size={16} aria-hidden="true" />
                Try again
              </button>
            )}
          </div>
        )}
        <div ref={endRef} className="chat-end" aria-hidden="true" />
      </section>

      <form className="composer" onSubmit={submit}>
        <label htmlFor="chat-question" className="visually-hidden">
          Ask a question about this document
        </label>
        <textarea
          ref={inputRef}
          id="chat-question"
          className="field composer-input"
          rows={1}
          value={question}
          placeholder="Ask a follow-up question"
          maxLength={MAX_QUESTION_CHARS}
          dir="auto"
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="composer-actions">
          {question.length >= COUNT_FROM && (
            <span className="composer-count">
              {formatCount(question.length)} / {formatCount(MAX_QUESTION_CHARS)}
            </span>
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
            disabled={question.trim().length === 0 || chat.streaming}
          >
            <ArrowUp size={18} aria-hidden="true" />
          </button>
        </div>
      </form>
    </>
  );
}

const ChatMessage = memo(function ChatMessage({ message }: { message: StoredMessage }) {
  if (message.role === 'user') {
    return (
      <li className="msg msg-user">
        <span className="visually-hidden">You asked: </span>
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

const REMARK_PLUGINS = [remarkGfm];
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
