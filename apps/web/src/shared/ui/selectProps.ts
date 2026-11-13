import type { ReactNode } from 'react';

export type SelectOption<T extends string> = {
  value: T;
  label: string;

  icon?: ReactNode;
  tone?: 'quiet' | 'alert';
};

export type SelectProps<T extends string> = {
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption<T>[];
  value: T;
  onChange: (next: T) => void;
  isDisabled?: boolean;

  compact?: boolean;
  className?: string;
};
