import { CalendarDays } from 'lucide-react';
import { lazy, Suspense } from 'react';
import type { DatePickerProps } from './datePickerProps';
import styles from './DatePicker.module.css';

export type { DatePickerProps } from './datePickerProps';

const DatePickerControl = lazy(() => import('./DatePickerControl'));

export function DatePicker(props: DatePickerProps) {
  return (
    <Suspense
      fallback={
        <div className={styles.picker} aria-busy="true">
          <span className={styles.label}>{props.label}</span>
          <span className={styles.group}>
            <span className={styles.input}>{props.value ?? ''}</span>
            <span className={styles.trigger}>
              <CalendarDays aria-hidden="true" />
            </span>
          </span>
        </div>
      }
    >
      <DatePickerControl {...props} />
    </Suspense>
  );
}
