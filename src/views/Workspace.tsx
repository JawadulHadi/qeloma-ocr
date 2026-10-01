import { useCallback, useEffect, useRef, useState } from 'react';
import { FileUp, LogIn, Plus, TriangleAlert, X } from 'lucide-react';
import type { SessionUser } from '../../shared/types';
import { useAuth } from '../auth';
import { AnalysisPane } from '../components/AnalysisPane';
import { AppHeader } from '../components/AppHeader';
import type { SourceActions } from '../components/useFilePicker';
import { CitationContext } from '../components/citationContext';
import { HistoryMenu } from '../components/HistoryMenu';
import { PasteTextModal } from '../components/PasteTextModal';
import { SourcesPanel } from '../components/SourcesPanel';
import { SourceViewer } from '../components/SourceViewer';
import { Tabs } from '../components/Tabs';
import { UploadPanel } from '../components/UploadPanel';
import { useMediaQuery } from '../components/useMediaQuery';
import { UserMenu } from '../components/UserMenu';
import { useConversation } from '../hooks/useConversation';
import type { SkippedFile } from '../lib/bundle';
import { PickerError, PopupBlockedError } from '../lib/pickers/common';
import { pickFromDrive } from '../lib/pickers/drive';
import type { OneDriveSession } from '../lib/pickers/onedrive';
import type { MessageQuote, SourceOrigin } from '../lib/store';

type PaneTab = 'sources' | 'chat';

/** Something to tell the reader about a Drive or OneDrive pick, with an optional follow-up action. */
interface Notice {
  message: string;
  action?: { label: string; run(): void };
}

const PICKER_FAILED = 'Something went wrong while picking files. Try again.';

function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false;
}

/** Drag-and-drop anywhere on the page; the overlay shows while files are over the window. */
function useWindowDrop(onFiles: (files: File[]) => void): boolean {
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
      const files = [...(event.dataTransfer?.files ?? [])];
      if (files.length > 0) onFiles(files);
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
  }, [onFiles]);

  return dragging;
}

interface WorkspaceProps {
  /** null when nobody has signed in: files are still read on this device, but the AI needs a sign-in. */
  user: SessionUser | null;
  /** Takes someone who hasn't signed in to the sign-in page. */
  onSignIn?(): void;
}

/**
 * A notebook of sources: the Sources list (or one open source) on the left, the combined summary and the chat
 * on the right. On phones the two columns become tabs. Before anything is added, a big upload panel.
 */
export function Workspace({ user, onSignIn }: WorkspaceProps) {
  const { signOut, config } = useAuth();
  const controller = useConversation(user);
  const { guest, state, history } = controller;
  const { conversation, reading } = state;
  const wide = useMediaQuery('(min-width: 1024px)');
  const narrowHeader = useMediaQuery('(max-width: 639px)');
  const [tab, setTab] = useState<PaneTab>('sources');
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [quote, setQuote] = useState<MessageQuote | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const oneDrive = useRef<OneDriveSession | null>(null);

  // A different conversation (or a new one) starts with the source list and an empty composer.
  const conversationId = conversation?.id ?? null;
  const [seenConversation, setSeenConversation] = useState(conversationId);
  if (seenConversation !== conversationId) {
    setSeenConversation(conversationId);
    setOpenSourceId(null);
    setQuote(null);
  }

  // On phones, show the summary the moment it is ready.
  const summarizing = state.analysis.running;
  const [seenSummarizing, setSeenSummarizing] = useState(summarizing);
  if (seenSummarizing !== summarizing) {
    setSeenSummarizing(summarizing);
    if (!summarizing && conversation?.analysis && !state.analysis.error) setTab('chat');
  }

  const { addFiles: queueFiles, cancelAllReading } = controller;
  const addFiles = useCallback(
    (files: File[], origin: SourceOrigin = 'upload', skipped: SkippedFile[] = []) => {
      void queueFiles(files, origin, skipped);
    },
    [queueFiles],
  );
  const dragging = useWindowDrop(addFiles);

  const busyCount = reading.filter((item) => item.status !== 'failed').length;
  useEffect(() => {
    if (busyCount === 0) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Escape inside an open menu or dialog belongs to it.
      if (document.querySelector('dialog[open], .sw-dropdown-panel')) return;
      cancelAllReading();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [busyCount, cancelAllReading]);

  const pickerFailed = (err: unknown) => {
    if (err instanceof PickerError) {
      if (!err.silent) setNotice({ message: err.message });
    } else {
      setNotice({ message: PICKER_FAILED });
    }
  };

  const pickDrive = async () => {
    if (!config?.drive || !config.googleClientId) return;
    setNotice(null);
    try {
      const bundle = await pickFromDrive({ clientId: config.googleClientId, ...config.drive });
      addFiles(bundle.files, 'drive', bundle.skipped);
    } catch (err) {
      pickerFailed(err);
    }
  };

  const pickOneDrive = async () => {
    const clientId = config?.oneDrive?.clientId;
    if (!clientId) return;
    setNotice(null);
    try {
      const { connectOneDrive, pickFromOneDrive } = await import('../lib/pickers/onedrive');
      oneDrive.current ??= await connectOneDrive(clientId);
      const bundle = await pickFromOneDrive(oneDrive.current);
      addFiles(bundle.files, 'onedrive', bundle.skipped);
    } catch (err) {
      if (err instanceof PopupBlockedError) {
        // Signing in used up the click that allows a new window; one more click opens the picker.
        setNotice({
          message: 'You’re signed in to Microsoft.',
          action: { label: 'Choose files from OneDrive', run: () => void pickOneDrive() },
        });
      } else {
        pickerFailed(err);
      }
    }
  };

  const actions: SourceActions = {
    onFiles: (files) => addFiles(files),
    onPaste: () => setPasteOpen(true),
    onDrive: config?.drive && config.googleClientId ? () => void pickDrive() : undefined,
    onOneDrive: config?.oneDrive ? () => void pickOneDrive() : undefined,
  };

  const showSource = (sourceId: string) => {
    setOpenSourceId(sourceId);
    if (!wide) setTab('sources');
  };

  const openSource = conversation?.sources.find((source) => source.id === openSourceId) ?? null;
  const showUpload = !conversation && busyCount === 0;

  return (
    <>
      <AppHeader
        start={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={controller.reset}
              aria-label={narrowHeader ? 'New conversation' : undefined}
            >
              <Plus size={18} aria-hidden="true" />
              {!narrowHeader && <span>New</span>}
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
        {notice && (
          <div className="alert alert-warn workspace-notice" role="alert">
            <TriangleAlert className="alert-icon" size={18} aria-hidden="true" />
            <div className="alert-body">
              <p>{notice.message}</p>
              {notice.action && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    const { run } = notice.action ?? {};
                    setNotice(null);
                    run?.();
                  }}
                >
                  {notice.action.label}
                </button>
              )}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X aria-hidden="true" />
            </button>
          </div>
        )}

        {showUpload ? (
          <UploadPanel
            guest={guest}
            actions={actions}
            failures={reading.filter((item) => item.status === 'failed')}
            onDismiss={controller.cancelReading}
          />
        ) : (
          <CitationContext value={{ sources: conversation?.sources ?? [], open: showSource }}>
            <div className="work">
              {!wide && (
                <Tabs<PaneTab>
                  label="Workspace"
                  className="work-tabs"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'sources', label: 'Sources', panelId: 'pane-sources' },
                    { value: 'chat', label: guest ? 'Summary' : 'Summary & chat', panelId: 'pane-chat' },
                  ]}
                />
              )}
              <section
                id="pane-sources"
                className="pane pane-sources panel"
                aria-label={wide ? 'Sources' : undefined}
                role={wide ? undefined : 'tabpanel'}
                aria-labelledby={wide ? undefined : 'pane-sources-tab'}
                hidden={!wide && tab !== 'sources'}
              >
                {openSource ? (
                  <SourceViewer
                    key={openSource.id}
                    source={openSource}
                    canQuote={!guest}
                    onBack={() => setOpenSourceId(null)}
                    onSaveText={(text) => controller.updateSourceText(openSource.id, text)}
                    onRemove={() => {
                      controller.removeSource(openSource.id);
                      setOpenSourceId(null);
                    }}
                    onQuote={(text) => {
                      setQuote({ sourceId: openSource.id, label: openSource.label, text });
                      setFocusRequest((n) => n + 1);
                      if (!wide) setTab('chat');
                    }}
                  />
                ) : (
                  <SourcesPanel
                    sources={conversation?.sources ?? []}
                    reading={reading}
                    actions={actions}
                    onOpen={setOpenSourceId}
                    onToggle={controller.setSourceIncluded}
                    onToggleAll={controller.setAllIncluded}
                    onCancelReading={controller.cancelReading}
                    onCancelAll={controller.cancelAllReading}
                  />
                )}
              </section>
              <section
                id="pane-chat"
                className="pane pane-analysis panel"
                aria-label={wide ? 'Summary and chat' : undefined}
                role={wide ? undefined : 'tabpanel'}
                aria-labelledby={wide ? undefined : 'pane-chat-tab'}
                hidden={!wide && tab !== 'chat'}
              >
                <AnalysisPane
                  guest={guest}
                  conversation={conversation}
                  readingCount={busyCount}
                  analysis={state.analysis}
                  chat={state.chat}
                  quote={quote}
                  focusRequest={focusRequest}
                  canTranscribe={!guest && (config?.aiConfigured ?? false)}
                  onAnalyze={() => void controller.analyze()}
                  onCancelAnalysis={controller.cancelAnalysis}
                  onExport={controller.exportCurrent}
                  onAsk={(question, withQuote) => void controller.ask(question, withQuote)}
                  onClearQuote={() => setQuote(null)}
                  onStopAnswer={controller.stopAnswer}
                />
              </section>
            </div>
          </CitationContext>
        )}
      </main>

      <PasteTextModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onAdd={(title, text) => void controller.addText(title, text)}
      />

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card panel-raised">
            <FileUp size={28} />
            <p>Drop to add {conversation ? 'these sources' : 'these files'}</p>
          </div>
        </div>
      )}
    </>
  );
}
