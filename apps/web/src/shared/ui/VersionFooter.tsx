import layouts from '../../styles/layouts.module.css';
import { APP_NAME } from '../lib/appName';
import { useHealth } from '../lib/useHealth';

export function VersionFooter() {
  const health = useHealth();
  return (
    <footer className={layouts.productFooter}>
      <span className={layouts.footerLeft}>
        {APP_NAME} v{health.data?.version ?? '…'}
      </span>
    </footer>
  );
}
