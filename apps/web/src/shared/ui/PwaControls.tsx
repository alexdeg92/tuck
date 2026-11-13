import { useEffect, useState } from 'react';
import { Button } from './Button';

type InstallPrompt = Event & { prompt: () => Promise<{ outcome: string }> };
function isInstallPrompt(event: Event): event is InstallPrompt {
  return 'prompt' in event && typeof event.prompt === 'function';
}
function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true)
  );
}

export type InstallOffer = { available: boolean; busy: boolean; install: () => void };

export function useInstallOffer(): InstallOffer {
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [installed, setInstalled] = useState(standalone);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const offer = (event: Event) => {
      if (isInstallPrompt(event)) {
        event.preventDefault();
        setPrompt(event);
      }
    };
    const done = () => {
      setInstalled(true);
      setPrompt(null);
    };
    const mode = window.matchMedia('(display-mode: standalone)');
    const display = () => {
      setInstalled(standalone());
    };
    window.addEventListener('beforeinstallprompt', offer);
    window.addEventListener('appinstalled', done);
    mode.addEventListener('change', display);
    return () => {
      window.removeEventListener('beforeinstallprompt', offer);
      window.removeEventListener('appinstalled', done);
      mode.removeEventListener('change', display);
    };
  }, []);
  return {
    available: !installed && prompt !== null,
    busy,
    install: () => {
      if (busy || prompt === null) return;
      setBusy(true);
      void prompt
        .prompt()
        .then(() => {
          setPrompt(null);
        })
        .catch(() => {
          setPrompt(null);
        })
        .finally(() => {
          setBusy(false);
        });
    },
  };
}

export function InstallButton({ offer }: { offer: InstallOffer }) {
  if (!offer.available) return null;
  return (
    <Button
      disabled={offer.busy}
      aria-busy={offer.busy}
      aria-label="Install app"
      busyLabel="Opening installation"
      onClick={offer.install}
    >
      <span className="label">Install app</span>
    </Button>
  );
}

export function PwaControls() {
  return <InstallButton offer={useInstallOffer()} />;
}
