import { lazy, Suspense, useState } from 'react';
import { AuthProvider, useAuth } from './auth';
import { Wordmark } from './components/Wordmark';
import { Landing } from './views/Landing';

// The workspace (extraction, analysis, chat) loads only once someone signs in or chooses to upload without signing in.
const Workspace = lazy(() => import('./views/Workspace').then((module) => ({ default: module.Workspace })));

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}

function Shell() {
  const { status, user } = useAuth();
  /** Chose to upload without signing in. Documents read this way move into the account on sign-in. */
  const [guest, setGuest] = useState(false);
  if (status === 'loading') return <Loading />;
  if (status === 'signed-in' && user) {
    // Signing out later should land on the landing page, not back in the guest workspace.
    if (guest) setGuest(false);
    return (
      <Suspense fallback={<Loading />}>
        {/* Keyed by account so nothing from one person's workspace survives into another's. */}
        <Workspace key={user.id} user={user} />
      </Suspense>
    );
  }
  if (guest) {
    return (
      <Suspense fallback={<Loading />}>
        <Workspace key="guest" user={null} onSignIn={() => setGuest(false)} />
      </Suspense>
    );
  }
  return <Landing onStart={() => setGuest(true)} />;
}

function Loading() {
  return (
    <div className="boot" role="status">
      <Wordmark large />
      <span className="boot-lamp" aria-hidden="true" />
      <span className="visually-hidden">Loading Scanwise…</span>
    </div>
  );
}
