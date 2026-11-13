import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router';
import { GuestOnly, RequireSession } from '../features/auth/components/RequireSession';
import { useLogout, useLogoutEverywhere, useSession } from '../features/auth/hooks';
import { ListSearch } from '../features/search/components/ListSearch';
import { TaskSearch } from '../features/search/components/TaskSearch';
import { SignInPage } from '../features/auth/pages/SignInPage';
import { SignUpPage } from '../features/auth/pages/SignUpPage';
import { AccountBar } from '../shared/ui/AccountBar';
import { TaskDetailPage } from '../features/tasks/pages/TaskDetailPage';
import { TaskListPage } from '../features/tasks/pages/TaskListPage';
import { discardPendingSaves, flushPendingSaves } from '../features/tasks/autosave';
import { clearDrafts } from '../features/tasks/drafts';
import { TrashLink } from '../features/trash/components/TrashLink';
import { TrashDetailPage } from '../features/trash/pages/TrashDetailPage';
import { TrashPage } from '../features/trash/pages/TrashPage';

function TaskDetailRoute() {
  const session = useSession();
  return <TaskDetailPage ownerId={session.data?.id} search={TaskSearch} />;
}

/**
 * Sign out of this device, or of every device (the server revokes every session of the
 * account). Either way: send what can still be sent, then nothing of this user's stays here.
 */
function useSignOut() {
  const session = useSession();
  const logout = useLogout();
  const logoutEverywhere = useLogoutEverywhere();
  const navigate = useNavigate();
  return (scope: 'device' | 'everywhere') => {
    const userId = session.data?.id;
    void flushPendingSaves()
      .catch(() => undefined)
      .then(async () => {
        discardPendingSaves();
        if (userId !== undefined) clearDrafts(userId);
        await (scope === 'everywhere' ? logoutEverywhere : logout).mutateAsync();
        await navigate('/signin', { replace: true });
      });
  };
}

function TaskListRoute() {
  const session = useSession();
  const signOut = useSignOut();
  return (
    <ListSearch>
      {(search) => (
        <TaskListPage
          email={session.data?.email ?? ''}
          search={search}
          footer={<TrashLink />}
          onSignOut={() => {
            signOut('device');
          }}
          onSignOutEverywhere={() => {
            signOut('everywhere');
          }}
        />
      )}
    </ListSearch>
  );
}

/** The trash keeps the account bar of the task list; the trash feature knows nothing of auth. */
function TrashRoute() {
  const session = useSession();
  const signOut = useSignOut();
  return (
    <TrashPage
      account={
        <AccountBar
          email={session.data?.email ?? ''}
          onSignOut={() => {
            signOut('device');
          }}
          onSignOutEverywhere={() => {
            signOut('everywhere');
          }}
        />
      }
    />
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/signin"
        element={
          <GuestOnly>
            <SignInPage />
          </GuestOnly>
        }
      />
      <Route
        path="/signup"
        element={
          <GuestOnly>
            <SignUpPage />
          </GuestOnly>
        }
      />
      <Route
        path="/tasks"
        element={
          <RequireSession>
            <TaskListRoute />
          </RequireSession>
        }
      >
        <Route path=":id" element={<TaskDetailRoute />} />
      </Route>
      <Route
        path="/trash"
        element={
          <RequireSession>
            <TrashRoute />
          </RequireSession>
        }
      >
        <Route path=":id" element={<TrashDetailPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/tasks" replace />} />
      <Route path="*" element={<Navigate to="/tasks" replace />} />
    </Routes>
  );
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
