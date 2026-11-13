import { useEffect, useState, useSyncExternalStore } from 'react';
import { getReadyUpdate, subscribeReadyUpdate, reloadReadyUpdate } from '../pwa/update';
import { Button } from './Button';
import { PwaSurface } from './PwaSurface';

export function ConnectivityStatus() {
  const ready = useSyncExternalStore(subscribeReadyUpdate, getReadyUpdate);
  const [reloading, setReloading] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);
  const [updated, setUpdated] = useState(() => sessionStorage.getItem('tuck:updated') !== null);
  useEffect(() => {
    sessionStorage.removeItem('tuck:updated');
    const update = () => {
      setOffline(!navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    const timer = setTimeout(() => {
      setUpdated(false);
    }, 6000);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return (
    <>
      <PwaSurface visible={ready !== null} status notificationPriority={25}>
        A new version is ready ·{' '}
        <Button
          variant="ghost"
          disabled={reloading}
          aria-busy={reloading}
          busyLabel="Saving changes"
          onClick={() => {
            setReloading(true);
            void reloadReadyUpdate()
              .catch(() => {
                /* Keep the notice available when an edit cannot be saved yet. */
              })
              .finally(() => {
                setReloading(false);
              });
          }}
        >
          Reload
        </Button>
      </PwaSurface>
      <PwaSurface visible={updated} status notificationPriority={30}>
        Updated to v{import.meta.env.VITE_APP_VERSION}
      </PwaSurface>
      <PwaSurface visible={offline} status notificationPriority={20}>
        You’re offline. Reconnect to load and save tasks.
      </PwaSurface>
    </>
  );
}
