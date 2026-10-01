import { useState } from 'react';
import { Download, LogOut, Trash2 } from 'lucide-react';
import type { SessionUser } from '../../shared/types';
import { initials } from './format';
import { Dropdown } from './ui/Dropdown';

interface UserMenuProps {
  user: SessionUser;
  hasHistory: boolean;
  onExportAll(): void;
  onClearHistory(): void;
  onSignOut(): void;
}

function Avatar({ user }: { user: SessionUser }) {
  const [failed, setFailed] = useState(false);
  if (user.picture && !failed) {
    return (
      <img
        className="avatar"
        src={user.picture}
        alt=""
        width={32}
        height={32}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span className="avatar avatar-initials" aria-hidden="true">
      {initials(user.name, user.email)}
    </span>
  );
}

/** The account menu behind the Google avatar. */
export function UserMenu({ user, hasHistory, onExportAll, onClearHistory, onSignOut }: UserMenuProps) {
  return (
    <Dropdown
      label={`Account: ${user.name}`}
      triggerClassName="avatar-btn"
      align="end"
      width={300}
      panelClassName="user-panel"
      trigger={<Avatar user={user} />}
    >
      {({ close }) => (
        <UserPanel
          user={user}
          hasHistory={hasHistory}
          onExportAll={() => {
            close();
            onExportAll();
          }}
          onClearHistory={onClearHistory}
          onSignOut={() => {
            close();
            onSignOut();
          }}
        />
      )}
    </Dropdown>
  );
}

function UserPanel({ user, hasHistory, onExportAll, onClearHistory, onSignOut }: UserMenuProps) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="user">
      <div className="user-id">
        <p className="user-name">{user.name}</p>
        <p className="user-email">{user.email}</p>
      </div>
      <ul className="menu-list">
        <li>
          <button type="button" className="menu-item" onClick={onExportAll} disabled={!hasHistory}>
            <Download size={16} aria-hidden="true" />
            Export all as Markdown
          </button>
        </li>
        <li>
          {confirming ? (
            <div className="menu-confirm" role="group" aria-label="Clear history">
              <p>Delete every saved document in this browser? This can’t be undone.</p>
              <div className="menu-confirm-actions">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    setConfirming(false);
                    onClearHistory();
                  }}
                >
                  Delete all
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(false)} autoFocus>
                  Keep
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="menu-item" onClick={() => setConfirming(true)} disabled={!hasHistory}>
              <Trash2 size={16} aria-hidden="true" />
              Clear history on this device
            </button>
          )}
        </li>
        <li>
          <button type="button" className="menu-item" onClick={onSignOut}>
            <LogOut size={16} aria-hidden="true" />
            Sign out
          </button>
        </li>
      </ul>
    </div>
  );
}
