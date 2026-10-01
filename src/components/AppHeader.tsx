import type { ReactNode } from 'react';
import { AppearanceMenu } from '../theme';
import { useMediaQuery } from './useMediaQuery';
import { Wordmark } from './Wordmark';

interface AppHeaderProps {
  /** Actions next to the wordmark, e.g. New document and History. */
  start?: ReactNode;
  /** Items after the Appearance menu, e.g. the account menu. */
  end?: ReactNode;
}

/** The sticky top bar: wordmark and document actions on the left, appearance and account on the right. */
export function AppHeader({ start, end }: AppHeaderProps) {
  const narrow = useMediaQuery('(max-width: 639px)');
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Wordmark />
        {start && <div className="app-header-start">{start}</div>}
        <div className="app-header-end">
          <AppearanceMenu compact={narrow} />
          {end}
        </div>
      </div>
    </header>
  );
}
