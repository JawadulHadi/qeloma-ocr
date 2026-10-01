import { useState } from 'react';
import { Download, History, Search, Trash2 } from 'lucide-react';
import type { ConversationSummary } from '../lib/store';
import { FileIcon } from './FileIcon';
import { formatRelativeDate } from './format';
import { Dropdown } from './ui/Dropdown';

interface HistoryMenuProps {
  history: ConversationSummary[];
  currentId: string | null;
  compact: boolean;
  onOpen(id: string): void;
  onDelete(id: string): void;
  onExportAll(): void;
}

/** Saved documents in this browser: search, reopen, delete, export. */
export function HistoryMenu({ history, currentId, compact, onOpen, onDelete, onExportAll }: HistoryMenuProps) {
  return (
    <Dropdown
      label="History"
      align="start"
      width={380}
      panelClassName="history-panel"
      trigger={
        <>
          <History size={18} aria-hidden="true" />
          {!compact && <span>History</span>}
        </>
      }
    >
      {({ close }) => (
        <HistoryPanel
          history={history}
          currentId={currentId}
          onOpen={(id) => {
            close();
            onOpen(id);
          }}
          onDelete={onDelete}
          onExportAll={() => {
            close();
            onExportAll();
          }}
        />
      )}
    </Dropdown>
  );
}

function matches(item: ConversationSummary, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [item.title, item.typeLabel, ...item.sourceNames].some((value) => value.toLowerCase().includes(q));
}

function HistoryPanel({
  history,
  currentId,
  onOpen,
  onDelete,
  onExportAll,
}: Omit<HistoryMenuProps, 'compact'>) {
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const visible = history.filter((item) => matches(item, query));

  if (history.length === 0) {
    return (
      <p className="menu-empty">Nothing here yet. Your conversations appear here once you add a source.</p>
    );
  }

  return (
    <div className="history">
      <div className="history-search">
        <Search size={16} aria-hidden="true" className="history-search-icon" />
        <label htmlFor="history-search" className="visually-hidden">
          Search history
        </label>
        <input
          id="history-search"
          type="search"
          className="field"
          placeholder="Search documents"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
      </div>

      {visible.length === 0 ? (
        <p className="menu-empty">No documents match “{query.trim()}”.</p>
      ) : (
        <ul className="history-list">
          {visible.map((item) =>
            confirming === item.id ? (
              <li key={item.id} className="history-item is-confirming">
                <p className="history-confirm">Delete “{item.title}”?</p>
                <div className="history-confirm-actions">
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => {
                      setConfirming(null);
                      onDelete(item.id);
                    }}
                  >
                    Delete
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} autoFocus>
                    Keep
                  </button>
                </div>
              </li>
            ) : (
              <li key={item.id} className={item.id === currentId ? 'history-item is-current' : 'history-item'}>
                <button
                  type="button"
                  className="history-open"
                  aria-current={item.id === currentId ? 'true' : undefined}
                  onClick={() => onOpen(item.id)}
                >
                  <span className="history-icon">
                    <FileIcon kind={item.kind} size={18} />
                  </span>
                  <span className="history-text">
                    <span className="history-title">{item.title}</span>
                    <span className="history-meta">
                      {item.typeLabel} · {formatRelativeDate(item.updatedAt)}
                      {item.hasAnalysis && (
                        <span className="history-analyzed">
                          <span className="history-dot" aria-hidden="true" />
                          Analyzed
                        </span>
                      )}
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-btn history-delete"
                  aria-label={`Delete ${item.title}`}
                  onClick={() => setConfirming(item.id)}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      <div className="menu-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onExportAll}>
          <Download size={16} aria-hidden="true" />
          Export all as Markdown
        </button>
      </div>
    </div>
  );
}
