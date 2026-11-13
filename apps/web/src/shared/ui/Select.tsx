import { ChevronDown } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { cx } from '../lib/cx';
import type { SelectProps } from './selectProps';
import styles from './Select.module.css';

export type { SelectOption, SelectProps } from './selectProps';

const SelectControl = lazy(() => import('./SelectControl'));

export function Select<T extends string>(props: SelectProps<T>) {
  const { label, hideLabel = false, options, value, onChange, compact = false, className } = props;
  const current = options.find((option) => option.value === value);
  return (
    <Suspense
      fallback={
        <div className={cx(styles.select, compact && styles.compact, className)} aria-busy="true">
          {hideLabel ? null : <span className={styles.label}>{label}</span>}
          <span className={styles.trigger} data-tone={current?.tone}>
            <span className={styles.value}>
              {current?.icon}
              {current?.label}
            </span>
            <ChevronDown className={styles.chevron} aria-hidden="true" />
          </span>
        </div>
      }
    >
      <SelectControl
        {...props}
        onChange={(next) => {
          const option = options.find((candidate) => candidate.value === next);
          if (option !== undefined) onChange(option.value);
        }}
      />
    </Suspense>
  );
}
