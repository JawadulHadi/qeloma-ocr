import { FileUp, ShieldCheck, TriangleAlert } from 'lucide-react';
import { GoogleSignInButton, useAuth } from '../auth';
import { AppHeader } from '../components/AppHeader';
import { useTheme } from '../theme';
import { Specimen } from './Specimen';

const STEPS = [
  { title: 'Extract', text: 'Text comes out of any file, with a confidence score for every word.' },
  { title: 'Understand', text: 'Get a summary, key factors and key points in plain language.' },
  {
    title: 'Act',
    text: 'See the options the document offers and practical next steps. Ask follow-ups. Export as Markdown.',
  },
];

/** The signed-out page: what Scanwise does, a live specimen, and the two ways in. */
export function Landing({ onStart }: { onStart(): void }) {
  const { error } = useAuth();
  const { theme } = useTheme();

  return (
    <>
      <AppHeader />
      <main className="landing" id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <h1 id="hero-title" className="hero-title">
              Know what a document says — and what to do about it.
            </h1>
            <p className="hero-sub">
              Upload a photo, scan, PDF or Office file. Scanwise reads the text, shows how sure it is, then lays out
              the key factors and your options.
            </p>
            {error && (
              <div className="alert alert-warn" role="alert">
                <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
                <p className="alert-body">{error}</p>
              </div>
            )}
            <div className="hero-actions">
              <button type="button" className="btn btn-primary hero-start" onClick={onStart}>
                <FileUp size={20} aria-hidden="true" />
                Upload a document
              </button>
              <p className="hero-or">No account needed to read a file. Sign in for the AI analysis, chat and saved history:</p>
              <div className="hero-signin">
                <GoogleSignInButton mode={theme.mode} width={300} />
              </div>
            </div>
            <p className="hero-privacy">
              <ShieldCheck size={16} aria-hidden="true" />
              <span>
                Images and PDFs are read in your browser. Only the extracted text is sent for analysis — unless you
                choose AI vision.
              </span>
            </p>
          </div>
          <Specimen />
        </section>

        <section className="steps" aria-labelledby="steps-title">
          <h2 id="steps-title" className="visually-hidden">
            How it works
          </h2>
          <ol className="steps-list">
            {STEPS.map((step, index) => (
              <li key={step.title} className="step">
                <span className="step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="step-title">{step.title}</h3>
                <p className="step-text">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
      <footer className="landing-foot">
        <p>Files are read in your browser. Your history stays in this browser.</p>
      </footer>
    </>
  );
}
