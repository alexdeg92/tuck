import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from './AuthForm.module.css';

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div className={styles.formAlert} role="alert">
      <CircleAlert className={styles.alertIcon} aria-hidden="true" />
      <p>{children}</p>
    </div>
  );
}
