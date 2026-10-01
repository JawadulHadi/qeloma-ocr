import { ClipboardType, Cloud, FileUp, HardDrive, Plus } from 'lucide-react';
import { Dropdown } from './ui/Dropdown';
import { useFilePicker, type SourceActions } from './useFilePicker';

/** "Add sources": upload, Google Drive, OneDrive or pasted text. */
export function AddSourcesMenu({ actions, compact = false }: { actions: SourceActions; compact?: boolean }) {
  const picker = useFilePicker(actions.onFiles);
  return (
    <>
      <Dropdown
        label="Add sources"
        triggerClassName="btn btn-sm"
        align="end"
        width={280}
        panelClassName="add-panel"
        trigger={
          <>
            <Plus size={16} aria-hidden="true" />
            {!compact && <span>Add sources</span>}
          </>
        }
      >
        {({ close }) => (
          <ul className="menu-list">
            <li>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close();
                  picker.open();
                }}
              >
                <FileUp size={16} aria-hidden="true" />
                <span>
                  Upload files
                  <span className="menu-item-note">Several at once, or a .zip</span>
                </span>
              </button>
            </li>
            {actions.onDrive && (
              <li>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    actions.onDrive?.();
                  }}
                >
                  <HardDrive size={16} aria-hidden="true" />
                  Google Drive
                </button>
              </li>
            )}
            {actions.onOneDrive && (
              <li>
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    close();
                    actions.onOneDrive?.();
                  }}
                >
                  <Cloud size={16} aria-hidden="true" />
                  OneDrive
                </button>
              </li>
            )}
            <li>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  close();
                  actions.onPaste();
                }}
              >
                <ClipboardType size={16} aria-hidden="true" />
                Paste text
              </button>
            </li>
          </ul>
        )}
      </Dropdown>
      {picker.input}
    </>
  );
}
