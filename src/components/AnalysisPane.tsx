import type { ReactNode } from 'react';
import { CircleHelp, Download, Info, RotateCcw, Sparkles, TriangleAlert } from 'lucide-react';
import type { Analysis, Importance, KeyFactor } from '../../shared/types';
import { MAX_ANALYZE_CHARS } from '../../shared/limits';
import type { Phase, WorkspaceState } from '../hooks/useConversation';
import type { Conversation } from '../lib/store';
import { usePrefs } from '../lib/prefs';
import { ChatPanel } from './ChatPanel';
import { capitalize, formatCount } from './format';

interface AnalysisPaneProps {
  phase: Phase;
  conversation: Conversation | null;
  /** Message of a failed analysis, when phase is 'error'. */
  analyzeError: string | null;
  chat: WorkspaceState['chat'];
  onAnalyze(): void;
  onCancel(): void;
  onExport(): void;
  onAsk(question: string): void;
  onStopAnswer(): void;
}

const IMPORTANCE_RANK: Record<Importance, number> = { high: 0, medium: 1, low: 2 };

export function AnalysisPane({
  phase,
  conversation,
  analyzeError,
  chat,
  onAnalyze,
  onCancel,
  onExport,
  onAsk,
  onStopAnswer,
}: AnalysisPaneProps) {
  const analysis = conversation?.analysis ?? null;
  const chatOpen = phase === 'ready' && conversation !== null && analysis !== null;

  let body: ReactNode;
  if (phase === 'preparing' || phase === 'extracting') {
    body = <Waiting />;
  } else if (phase === 'analyzing') {
    body = <Analyzing onCancel={onCancel} />;
  } else if (phase === 'error') {
    body = (
      <>
        {!analysis && <h2 className="pane-label">Analysis</h2>}
        <div className="alert alert-danger" role="alert">
          <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
          <div className="alert-body">
            <p className="alert-title">The text couldn't be analyzed.</p>
            <p>{analyzeError ?? 'Something went wrong while analyzing the text.'}</p>
            <button type="button" className="btn btn-sm" onClick={onAnalyze}>
              <RotateCcw size={16} aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
        {analysis && conversation && <Report conversation={conversation} analysis={analysis} onExport={onExport} />}
      </>
    );
  } else if (analysis && conversation) {
    body = <Report conversation={conversation} analysis={analysis} onExport={onExport} />;
  } else {
    body = <Review text={conversation?.text ?? ''} onAnalyze={onAnalyze} />;
  }

  return (
    <div className="analysis">
      <div className="analysis-body">{body}</div>
      {chatOpen && <ChatPanel messages={conversation.messages} chat={chat} onAsk={onAsk} onStop={onStopAnswer} />}
    </div>
  );
}

function Waiting() {
  const [prefs] = usePrefs();
  return (
    <div className="analysis-waiting">
      <h2 className="pane-label">Analysis</h2>
      <p>
        {prefs.reviewBeforeAnalysis
          ? 'Once the text is read, you can check it before it’s analyzed.'
          : 'The analysis starts as soon as the text is read.'}
      </p>
    </div>
  );
}

function Review({ text, onAnalyze }: { text: string; onAnalyze(): void }) {
  const hasText = text.trim().length > 0;
  return (
    <>
      <h2 className="pane-label">Analysis</h2>
      <div className="callout callout-accent">
        <p className="callout-title">Check the text, then analyze it.</p>
        <p>
          {hasText
            ? 'Fix anything that was misread with Edit text. Only the text is sent for analysis.'
            : 'There’s no text to analyze yet. Add it with Edit text, or start a new document.'}
        </p>
        <button type="button" className="btn btn-primary" onClick={onAnalyze} disabled={!hasText}>
          <Sparkles size={16} aria-hidden="true" />
          Analyze text
        </button>
      </div>
    </>
  );
}

function Analyzing({ onCancel }: { onCancel(): void }) {
  return (
    <div className="analyzing">
      <h2 className="pane-label">Analysis</h2>
      <div className="analyzing-status">
        <p role="status" className="analyzing-label">
          <span className="lamp-dot" aria-hidden="true" />
          Analyzing the text…
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
        <span className="skeleton skeleton-heading" />
        <span className="skeleton skeleton-card is-wide" />
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
          Only the first {formatCount(MAX_ANALYZE_CHARS)} characters were analyzed.
        </p>
      )}

      <section className="report-section">
        <h3 className="section-title">Summary</h3>
        <p className="report-summary">{analysis.summary}</p>
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
              <li key={index}>{point}</li>
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
                    <span className="badge badge-ok">In the document</span>
                  ) : (
                    <span className="badge badge-accent">Suggested</span>
                  )}
                </div>
                <p className="card-text">{solution.description}</p>
                {solution.steps.length > 0 && (
                  <ol className="solution-steps">
                    {solution.steps.map((step, stepIndex) => (
                      <li key={stepIndex}>{step}</li>
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
                <span>{question}</span>
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
              <li key={index}>{caveat}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="report-foot">
        {conversation.model ? `Analyzed by ${conversation.model}. ` : ''}
        AI can get details wrong. Check dates, amounts and names against the document.
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
      <p className="card-text">{factor.detail}</p>
    </li>
  );
}
