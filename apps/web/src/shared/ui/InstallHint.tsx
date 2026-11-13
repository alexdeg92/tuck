import { useEffect, useState } from 'react';
import { useCompactNotifications } from '../lib/useCompactNotifications';
import { Button } from './Button';
import { PwaSurface } from './PwaSurface';
import styles from './InstallHint.module.css';

export function InstallHint() {
  const compact = useCompactNotifications();
  const [visible, setVisible] = useState(
    () =>
      /iPad|iPhone|iPod/.test(navigator.userAgent) &&
      /Safari/.test(navigator.userAgent) &&
      !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent) &&
      localStorage.getItem('tuck:ios-hint') !== 'dismissed' &&
      !window.matchMedia('(display-mode: standalone)').matches &&
      !('standalone' in navigator && navigator.standalone === true),
  );
  useEffect(() => {
    const installed = () => {
      setVisible(false);
    };
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return (
    <div>
      <PwaSurface visible={visible && !compact} className={styles.hint}>
        <span>Share → Add to Home Screen</span>
        <Button
          variant="ghost"
          aria-label="Dismiss install hint"
          onClick={() => {
            localStorage.setItem('tuck:ios-hint', 'dismissed');
            setVisible(false);
          }}
        >
          Dismiss
        </Button>
      </PwaSurface>
    </div>
  );
}
