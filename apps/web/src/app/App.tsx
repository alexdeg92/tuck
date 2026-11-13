import { TrashUndoProvider } from '../features/trash/components/TrashUndoProvider';
import { ConnectivityStatus } from '../shared/ui/ConnectivityStatus';
import { NotificationProvider } from '../shared/ui/NotificationStack';
import { Providers } from './providers';
import { AppRouter } from './router';

export function App() {
  return (
    <Providers>
      <NotificationProvider>
        <ConnectivityStatus />
        {/* Above every route: a Trash Undo survives navigating between the list and the Trash. */}
        <TrashUndoProvider>
          <AppRouter />
        </TrashUndoProvider>
      </NotificationProvider>
    </Providers>
  );
}
