import { lazy, Suspense } from 'react';
import { AuthProvider, useAuth } from './auth';
import { Wordmark } from './components/Wordmark';
import { Landing } from './views/Landing';

// The workspace (extraction, analysis, chat) loads only once someone is signed in.
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
  if (status === 'loading') return <Loading />;
  if (status === 'signed-in' && user) {
    return (
      <Suspense fallback={<Loading />}>
        {/* Keyed by account so nothing from one person's workspace survives into another's. */}
        <Workspace key={user.id} user={user} />
      </Suspense>
    );
  }
  return <Landing />;
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
