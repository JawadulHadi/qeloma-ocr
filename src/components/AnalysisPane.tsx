import type { ReactNode } from 'react';
import { CircleHelp, Download, Info, RefreshCw, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import type { Analysis, Importance, KeyFactor } from '../../shared/types';
import { MAX_ANALYZE_CHARS } from '../../shared/limits';
import { GoogleSignInButton } from '../auth';
import { isAnalysisStale, type WorkspaceState } from '../hooks/useConversation';
import { sourcesForAi, type Conversation, type MessageQuote } from '../lib/store';
import { useTheme } from '../theme';
import { ChatPanel } from './ChatPanel';
import { Cited } from './Citations';
import { capitalize, formatCount, plural } from './format';

interface AnalysisPaneProps {
  /** Nobody has signed in, so nothing can be sent to the AI yet. */
  guest: boolean;
  conversation: Conversation | null;
  /** Files still waiting or being read. */
  readingCount: number;
  analysis: WorkspaceState['analysis'];
  chat: WorkspaceState['chat'];
  quote: MessageQuote | null;
  focusRequest: number;
  canTranscribe: boolean;
  onAnalyze(): void;
  onCancelAnalysis(): void;
  onExport(): void;
  onAsk(question: string, quote?: MessageQuote): void;
  onClearQuote(): void;
  onStopAnswer(): void;
}

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

/** The right column: the combined summary of the ticked sources, then the chat about them. */
export function AnalysisPane(props: AnalysisPaneProps) {
  const { guest, conversation, readingCount, analysis: status, chat, onAnalyze, onCancelAnalysis, onExport } = props;
  const analysis = conversation?.analysis ?? null;
  const usable = conversation ? sourcesForAi(conversation).length : 0;
  const chatOpen = !guest && conversation !== null && conversation.sources.length > 0;

  let body: ReactNode;
  if (guest) {
    body = <SignInToAnalyze />;
  } else if (status.running) {
    body = <Analyzing count={usable} onCancel={onCancelAnalysis} />;
  } else if (status.error) {
    body = (
      <>
        {!analysis && <h2 className="pane-label">Summary</h2>}
        <div className="alert alert-danger" role="alert">
          <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
          <div className="alert-body">
            <p className="alert-title">The sources couldn't be summarized.</p>
            <p>{status.error}</p>
            <button type="button" className="btn btn-sm" onClick={onAnalyze} disabled={usable === 0}>
              <RotateCcw size={16} aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
        {analysis && conversation && <Report conversation={conversation} analysis={analysis} onExport={onExport} />}
      </>
    );
  } else if (analysis && conversation) {
    body = (
      <>
        {isAnalysisStale(conversation) && <StaleNotice usable={usable} onAnalyze={onAnalyze} />}
        <Report conversation={conversation} analysis={analysis} onExport={onExport} />
      </>
    );
  } else if (readingCount > 0) {
    body = (
      <div className="analysis-waiting">
        <h2 className="pane-label">Summary</h2>
        <p>The summary starts once {readingCount === 1 ? 'the file is' : 'all the files are'} read.</p>
      </div>
    );
  } else if (usable === 0) {
    body = (
      <div className="analysis-waiting">
        <h2 className="pane-label">Summary</h2>
        <p>Tick at least one source with text to get a summary and ask questions.</p>
      </div>
    );
  } else {
    body = <Review count={usable} onAnalyze={onAnalyze} />;
  }

  return (
    <div className="analysis">
      <div className="analysis-body">{body}</div>
      {chatOpen && (
        <ChatPanel
          messages={conversation.messages}
          chat={chat}
          sourceCount={usable}
          quote={props.quote}
          focusRequest={props.focusRequest}
          canTranscribe={props.canTranscribe}
          onAsk={props.onAsk}
          onClearQuote={props.onClearQuote}
          onStop={props.onStopAnswer}
        />
      )}
    </div>
  );
}

function SignInToAnalyze() {
  const { theme } = useTheme();
  return (
    <>
      <h2 className="pane-label">Summary</h2>
      <div className="callout callout-accent signin-callout">
        <p className="callout-title">Sign in to summarize and ask questions.</p>
        <p>
          Your files were read on this device and haven’t been sent anywhere. Sign in with Google for the summary, key
          factors, solutions and a chat about your sources. They stay open after you sign in.
        </p>
        <GoogleSignInButton mode={theme.mode} />
      </div>
    </>
  );
}

function Review({ count, onAnalyze }: { count: number; onAnalyze(): void }) {
  return (
    <>
      <h2 className="pane-label">Summary</h2>
      <div className="callout callout-accent">
        <p className="callout-title">Check the sources, then summarize them.</p>
        <p>
          Open a source to fix anything that was misread. Only the text of the {plural(count, 'ticked source')} is sent
          to the AI.
        </p>
        <button type="button" className="btn btn-primary" onClick={onAnalyze}>
          <Sparkles size={16} aria-hidden="true" />
          {count === 1 ? 'Summarize' : `Summarize ${count} sources`}
        </button>
      </div>
    </>
  );
}

function StaleNotice({ usable, onAnalyze }: { usable: number; onAnalyze(): void }) {
  return (
    <div className="stale" role="status">
      <p>
        <Info size={16} aria-hidden="true" />
        The sources changed since this summary was made.
      </p>
      <button type="button" className="btn btn-sm" onClick={onAnalyze} disabled={usable === 0}>
        <RefreshCw size={16} aria-hidden="true" />
        Update summary
      </button>
    </div>
  );
}

function Analyzing({ count, onCancel }: { count: number; onCancel(): void }) {
  return (
    <div className="analyzing">
      <h2 className="pane-label">Summary</h2>
      <div className="analyzing-status">
        <p role="status" className="analyzing-label">
          <span className="lamp-dot" aria-hidden="true" />
          {count > 1 ? `Reading ${count} sources together…` : 'Analyzing the text…'}
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
      </div>
      <div className="skeleton-stack" aria-hidden="true">
        <span className="skeleton skeleton-title" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line is-short" />
        <span className="skeleton skeleton-heading" />
        <div className="skeleton-cards">
          <span className="skeleton skeleton-card" />
          <span className="skeleton skeleton-card" />
        </div>
        <span className="skeleton skeleton-heading" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line is-short" />
      </div>
    </div>
  );
}

function Report({ conversation, analysis, onExport }: { conversation: Conversation; analysis: Analysis; onExport(): void }) {
  const factors = [...analysis.keyFactors].sort(
    (a, b) => IMPORTANCE_RANK[a.importance] - IMPORTANCE_RANK[b.importance],
  );
  const eyebrow = [analysis.documentType, analysis.language].filter(Boolean).join(' · ');

  return (
    <article className="report">
      <header className="report-head">
        <div className="report-heading">
          {eyebrow && <p className="pane-label">{eyebrow}</p>}
          <h2 className="report-title">{analysis.title}</h2>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExport}>
          <Download size={16} aria-hidden="true" />
          Export as Markdown
        </button>
      </header>

      {conversation.analysisTruncated && (
        <p className="note">
          <Info size={16} aria-hidden="true" />
          The sources were long, so only {formatCount(MAX_ANALYZE_CHARS)} characters of them were analyzed.
        </p>
      )}

      <section className="report-section">
        <h3 className="section-title">Summary</h3>
        <p className="report-summary">
          <Cited text={analysis.summary} />
        </p>
      </section>

      {factors.length > 0 && (
        <section className="report-section">
          <h3 className="section-title">
            Key factors <span className="section-count">{factors.length}</span>
          </h3>
          <ul className="card-list factor-list">
            {factors.map((factor, index) => (
              <FactorCard key={index} factor={factor} />
            ))}
          </ul>
        </section>
      )}

      {analysis.keyPoints.length > 0 && (
        <section className="report-section">
          <h3 className="section-title">Key points</h3>
          <ul className="point-list">
            {analysis.keyPoints.map((point, index) => (
              <li key={index}>
                <Cited text={point} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.solutions.length > 0 && (
        <section className="report-section">
          <h3 className="section-title">
            Solutions <span className="section-count">{analysis.solutions.length}</span>
          </h3>
          <ul className="card-list">
            {analysis.solutions.map((solution, index) => (
              <li key={index} className="card solution">
                <div className="card-top">
                  <h4 className="card-title">{solution.title}</h4>
                  {solution.source === 'document' ? (
                    <span className="badge badge-ok">In the sources</span>
                  ) : (
                    <span className="badge badge-accent">Suggested</span>
                  )}
                </div>
                <p className="card-text">
                  <Cited text={solution.description} />
                </p>
                {solution.steps.length > 0 && (
                  <ol className="solution-steps">
                    {solution.steps.map((step, stepIndex) => (
                      <li key={stepIndex}>
                        <Cited text={step} />
                      </li>
                    ))}
                  </ol>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.openQuestions.length > 0 && (
        <section className="report-section">
          <h3 className="section-title">Open questions</h3>
          <ul className="question-list">
            {analysis.openQuestions.map((question, index) => (
              <li key={index}>
                <CircleHelp size={16} aria-hidden="true" />
                <span>
                  <Cited text={question} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.caveats.length > 0 && (
        <section className="report-section callout callout-warn">
          <h3 className="section-title">
            <TriangleAlert size={16} aria-hidden="true" />
            Caveats
          </h3>
          <ul className="caveat-list">
            {analysis.caveats.map((caveat, index) => (
              <li key={index}>
                <Cited text={caveat} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="report-foot">
        {conversation.model ? `Analyzed by ${conversation.model}. ` : ''}
        AI can get details wrong. Check dates, amounts and names against the sources.
      </p>
    </article>
  );
}

function FactorCard({ factor }: { factor: KeyFactor }) {
  return (
    <li className="card factor">
      <div className="card-top">
        <h4 className="card-title">{factor.label}</h4>
        <span className={`importance importance-${factor.importance}`}>
          <span className="importance-dot" aria-hidden="true" />
          {capitalize(factor.importance)}
          <span className="visually-hidden"> importance</span>
        </span>
      </div>
      <p className="card-text">
        <Cited text={factor.detail} />
      </p>
    </li>
  );
}
