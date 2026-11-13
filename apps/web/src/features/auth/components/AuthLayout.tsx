import { FileText, Flag, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '../../../shared/ui/BrandMark';
import { VersionFooter } from '../../../shared/ui/VersionFooter';
import { WorkspacePreview } from './WorkspacePreview';
import styles from './AuthLayout.module.css';

const POINTS = [
  { icon: Plus, text: 'Capture tasks inline' },
  { icon: FileText, text: 'Keep notes with the task' },
  { icon: Flag, text: 'Set priorities, stay focused' },
] as const;

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <main className={styles.main}>
        <div className={styles.composition}>
          <section className={styles.product} aria-label="About Tuck">
            <p className={styles.wordmark}>
              <BrandMark className={styles.mark} />
              <span>Tuck</span>
            </p>
            <div className={styles.productBody}>
              <div className={styles.productCopy}>
                <p className={styles.headline}>
                  {}
                  Keep the work <br />
                  in view.
                </p>
                <p className={styles.value}>Tasks and notes, kept together.</p>
              </div>
              <WorkspacePreview />
              <ul className={styles.points}>
                {POINTS.map(({ icon: Icon, text }) => (
                  <li key={text}>
                    <Icon aria-hidden="true" />
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <div className={styles.formPane}>
            <div className={styles.formBody}>{children}</div>
          </div>
        </div>
      </main>
      <VersionFooter />
    </div>
  );
}
