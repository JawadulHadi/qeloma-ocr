import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, LogIn, Plus } from 'lucide-react';
import type { SessionUser } from '../../shared/types';
import { useAuth } from '../auth';
import { AnalysisPane } from '../components/AnalysisPane';
import { AppHeader } from '../components/AppHeader';
import { DocumentPane, type DocumentFile } from '../components/DocumentPane';
import { HistoryMenu } from '../components/HistoryMenu';
import { Tabs } from '../components/Tabs';
import { UploadPanel } from '../components/UploadPanel';
import { useMediaQuery } from '../components/useMediaQuery';
import { UserMenu } from '../components/UserMenu';
import { useConversation, type Phase } from '../hooks/useConversation';

type PaneTab = 'document' | 'analysis';

const BUSY: Phase[] = ['preparing', 'extracting', 'analyzing'];

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/** Drag-and-drop anywhere on the page; the overlay shows while a file is over the window. */
function useWindowDrop(onFile: (file: File) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      const file = event.dataTransfer?.files[0];
      if (file) onFile(file);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [onFile]);

  return dragging;
}

interface WorkspaceProps {
  /** null when nobody has signed in: files are still read on this device, but the AI needs a sign-in. */
  user: SessionUser | null;
  /** Takes someone who hasn't signed in to the sign-in page. */
  onSignIn?(): void;
}

/** An upload panel, then the document and its analysis side by side. */
export function Workspace({ user, onSignIn }: WorkspaceProps) {
  const { signOut } = useAuth();
  const controller = useConversation(user);
  const { guest, state, history, startFile, cancel, analyze, updateText } = controller;
  const { phase, conversation, error } = state;
  const wide = useMediaQuery('(min-width: 1024px)');
  const narrowHeader = useMediaQuery('(max-width: 639px)');
  const [tab, setTab] = useState<PaneTab>('document');
  const [seenPhase, setSeenPhase] = useState<Phase>(phase);

  // On narrow screens, jump to the analysis the moment it is ready; back to the document for a new file.
  if (seenPhase !== phase) {
    setSeenPhase(phase);
    if (phase === 'ready' && seenPhase === 'analyzing') setTab('analysis');
    if (phase === 'preparing') setTab('document');
  }

  const onFile = useCallback((file: File) => void startFile(file), [startFile]);
  const dragging = useWindowDrop(onFile);

  useEffect(() => {
    if (!BUSY.includes(phase)) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape inside an open menu or dialog belongs to it.
      if (document.querySelector('dialog[open], .sw-dropdown-panel')) return;
      cancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, cancel]);

  const saveText = (text: string) => {
    updateText(text);
    if (phase !== 'review') void analyze();
  };

  const showUpload = phase === 'empty' || (phase === 'error' && error?.stage === 'extract' && !conversation);
  const file: DocumentFile | null = conversation?.file ?? state.pendingFile;

  return (
    <>
      <AppHeader
        start={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={controller.reset}
              aria-label={narrowHeader ? 'New document' : undefined}
            >
              <Plus size={18} aria-hidden="true" />
              {!narrowHeader && <span>New document</span>}
            </button>
            <HistoryMenu
              history={history}
              currentId={conversation?.id ?? null}
              compact={narrowHeader}
              onOpen={(id) => void controller.open(id)}
              onDelete={(id) => void controller.remove(id)}
              onExportAll={() => void controller.exportAll()}
            />
          </>
        }
        end={
          user ? (
            <UserMenu
              user={user}
              hasHistory={history.length > 0}
              onExportAll={() => void controller.exportAll()}
              onClearHistory={() => void controller.clearHistory()}
              onSignOut={() => void signOut()}
            />
          ) : (
            <button type="button" className="btn btn-sm" onClick={onSignIn}>
              <LogIn size={16} aria-hidden="true" />
              Sign in
            </button>
          )
        }
      />

      <main className="workspace" id="main">
        {showUpload ? (
          <UploadPanel guest={guest} onFile={onFile} error={phase === 'error' ? (error?.message ?? null) : null} />
        ) : (
          <div className="work">
            {!wide && (
              <Tabs<PaneTab>
                label="Workspace"
                className="work-tabs"
                value={tab}
                onChange={setTab}
                options={[
                  { value: 'document', label: 'Document', panelId: 'pane-document' },
                  { value: 'analysis', label: 'Analysis', panelId: 'pane-analysis' },
                ]}
              />
            )}
            <section
              id="pane-document"
              className="pane pane-document panel"
              aria-label={wide ? 'Document' : undefined}
              role={wide ? undefined : 'tabpanel'}
              aria-labelledby={wide ? undefined : 'pane-document-tab'}
              hidden={!wide && tab !== 'document'}
            >
              <DocumentPane
                phase={phase}
                file={file}
                extraction={conversation?.extraction ?? null}
                text={conversation?.text ?? ''}
                textEdited={conversation?.textEdited ?? false}
                preview={state.preview}
                progress={state.progress}
                showAnalyzeAction={!guest && !wide && phase === 'review'}
                onCancel={cancel}
                onSaveText={saveText}
                onAnalyze={() => void analyze()}
              />
            </section>
            <section
              id="pane-analysis"
              className="pane pane-analysis panel"
              aria-label={wide ? 'Analysis' : undefined}
              role={wide ? undefined : 'tabpanel'}
              aria-labelledby={wide ? undefined : 'pane-analysis-tab'}
              hidden={!wide && tab !== 'analysis'}
            >
              <AnalysisPane
                guest={guest}
                phase={phase}
                conversation={conversation}
                analyzeError={error?.stage === 'analyze' ? error.message : null}
                chat={state.chat}
                onAnalyze={() => void analyze()}
                onCancel={cancel}
                onExport={controller.exportCurrent}
                onAsk={(question) => void controller.ask(question)}
                onStopAnswer={controller.stopAnswer}
              />
            </section>
          </div>
        )}
      </main>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card panel-raised">
            <FileUp size={28} />
            <p>Drop to read this file</p>
          </div>
        </div>
      )}
    </>
  );
}
