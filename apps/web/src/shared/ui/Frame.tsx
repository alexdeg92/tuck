import type { ReactNode } from 'react';
import { Link } from 'react-router';
import layouts from '../../styles/layouts.module.css';
import recipes from '../../styles/recipes.module.css';
import { APP_NAME } from '../lib/appName';
import { cx } from '../lib/cx';
import { BrandMark } from './BrandMark';
import styles from './Frame.module.css';
import { AppMenu } from './AppMenu';
import { InstallButton, useInstallOffer } from './PwaControls';
import { InstallHint } from './InstallHint';

export function AppShell({
  children,
  noteBar = false,
}: {
  children: ReactNode;
  noteBar?: boolean;
}) {
  return (
    <div className={layouts.app} data-note-bar={noteBar ? 'true' : undefined}>
      {children}
    </div>
  );
}

export function AppBar({
  children,
  note,
}: {
  children?: ReactNode;
  note?:
    | { bar: ReactNode; email: string; onSignOut: () => void; onSignOutEverywhere: () => void }
    | undefined;
}) {
  const install = useInstallOffer();
  return (
    <>
      {note ? (
        <header
          className={cx(recipes.material, recipes.appBar, layouts.appBarSlot, layouts.noteBar)}
        >
          {note.bar}
          <AppMenu
            email={note.email}
            onSignOut={note.onSignOut}
            onSignOutEverywhere={note.onSignOutEverywhere}
            install={install}
          />
        </header>
      ) : (
        <header className={cx(recipes.material, recipes.appBar, layouts.appBarSlot)}>
          <div className={layouts.barLeft}>
            <span className={recipes.brand}>
              <BrandMark className={recipes.brandMark} />
              <span>{APP_NAME}</span>
            </span>
          </div>
          <div className={cx(layouts.barRight, recipes.account)}>
            <InstallButton offer={install} />
            {children}
          </div>
        </header>
      )}
      <InstallHint />
    </>
  );
}

export function Workspace({ detailOpen, children }: { detailOpen: boolean; children: ReactNode }) {
  return (
    <main className={layouts.workspace} data-detail-open={String(detailOpen)}>
      {children}
    </main>
  );
}

export function Pane({
  pane,
  label,
  className,
  children,
}: {
  pane: 'master' | 'detail';
  label: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      className={cx(layouts.frame, pane === 'master' ? layouts.master : layouts.detail, className)}
      aria-label={label}
    >
      {children}
    </section>
  );
}

export function FrameHead({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <header className={cx(layouts.head, className)}>{children}</header>;
}

export function FrameBar({ children }: { children: ReactNode }) {
  return (
    <div className={cx(layouts.bar, layouts.masterBar)} role="toolbar" aria-label="Task tools">
      {children}
    </div>
  );
}

export function FrameBody({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return <div className={cx(layouts.body, className)}>{children}</div>;
}

export function BackLink({
  to,
  label,
  children,
}: {
  to: string;

  label?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Link className={cx('backToTasks', layouts.detailBack, styles.back)} to={to} aria-label={label}>
      {children}
    </Link>
  );
}
