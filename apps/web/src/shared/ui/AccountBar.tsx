import { ChevronDown, LogOut, MonitorX } from 'lucide-react';
import recipes from '../../styles/recipes.module.css';
import { cx } from '../lib/cx';
import { MenuButton, MenuItem, MenuNote, MenuSeparator } from './MenuButton';
import styles from './AccountBar.module.css';

/**
 * The signed-in account, the last thing in the app bar: one Account menu holding Sign out and,
 * under a separator, the rarer Sign out everywhere. The trigger shows the email's initial, then
 * the email and a chevron where the bar has room; on a phone it is the initial alone, so only
 * there does the menu repeat the email at its top. The trigger's name starts with the email it
 * shows (label in name), then says what it opens.
 */
export function AccountBar({
  email,
  onSignOut,
  onSignOutEverywhere,
}: {
  email: string;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
}) {
  return (
    <MenuButton
      label="Account"
      className={styles.host}
      triggerLabel={email === '' ? 'Account menu' : `${email}, Account menu`}
      triggerTitle={email}
      triggerClassName={cx(
        recipes.material,
        recipes.interactive,
        recipes.button,
        recipes.ghost,
        styles.trigger,
      )}
      trigger={
        <>
          {/* Drawn by CSS, so the visible text stays the email the name starts with. */}
          <span
            className={styles.initial}
            data-initial={email.charAt(0).toUpperCase()}
            aria-hidden="true"
          />
          <span className={cx(recipes.accountEmail, styles.email)}>{email}</span>
          <ChevronDown className={styles.chevron} aria-hidden="true" />
        </>
      }
    >
      {email === '' ? null : <MenuNote className={styles.phoneOnly}>{email}</MenuNote>}
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
