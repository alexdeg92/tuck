import { Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { SkeletonList } from '../../../shared/ui/States';
import { useSession, useSessionWatch } from '../hooks';

/** Keeps a signed-in tab's session checked while it is in view (see useSessionWatch). */
function SessionWatch() {
  useSessionWatch();
  return null;
}

export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();

  if (session.isLoading) {
    return <SkeletonList />;
  }

  if (session.isError || !session.data) {
    return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
  }

  return (
    <>
      <SessionWatch />
      {children}
    </>
  );
}

export function GuestOnly({ children }: { children: ReactNode }) {
  const session = useSession();

  if (session.isLoading) {
    return <SkeletonList />;
  }

  if (session.data) {
    return <Navigate to="/tasks" replace />;
  }

  return children;
}
