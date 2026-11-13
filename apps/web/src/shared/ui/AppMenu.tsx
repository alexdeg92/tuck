import { Download, LogOut, MonitorX, MoreHorizontal } from 'lucide-react';
import { cx } from '../lib/cx';
import styles from './AppMenu.module.css';
import { MenuButton, MenuItem, MenuNote, MenuSeparator } from './MenuButton';
import type { InstallOffer } from './PwaControls';

/**
 * The phone note bar's App menu: the account and the app actions that the bar has no room for
 * (Install app while the browser offers it, Sign out, and the quieter Sign out everywhere). The
 * note bar replaces the app bar, Account menu included, so this is the one place they live there.
 */
export function AppMenu({
  email,
  onSignOut,
  onSignOutEverywhere,
  install,
}: {
  email: string;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  install: InstallOffer;
}) {
  return (
    <MenuButton
      label="App menu"
      className={styles.appMenu}
      triggerClassName={cx('plainIcon', styles.trigger)}
      trigger={<MoreHorizontal aria-hidden="true" className="flowIcon" />}
    >
      <MenuNote>{email}</MenuNote>
      {install.available ? (
        <MenuItem
          returnFocus
          busy={install.busy}
          icon={<Download aria-hidden="true" className="flowIcon" />}
          onSelect={install.install}
        >
          Install app
        </MenuItem>
      ) : null}
      <MenuItem icon={<LogOut aria-hidden="true" className="flowIcon" />} onSelect={onSignOut}>
        Sign out
      </MenuItem>
      <MenuSeparator />
      <MenuItem
        secondary
        icon={<MonitorX aria-hidden="true" className="flowIcon" />}
        onSelect={onSignOutEverywhere}
      >
        Sign out everywhere
      </MenuItem>
    </MenuButton>
  );
}
