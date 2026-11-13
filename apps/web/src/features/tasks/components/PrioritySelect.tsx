import { TaskPriority } from '@todo/contracts';
import { Flag } from 'lucide-react';
import { formatPriority } from '../../../shared/lib/format';
import { Select, type SelectOption } from '../../../shared/ui/Select';

const OPTIONS: readonly SelectOption<TaskPriority>[] = TaskPriority.options.map((priority) => ({
  value: priority,
  label: formatPriority(priority),
  ...(priority === 'high'
    ? { icon: <Flag aria-hidden="true" />, tone: 'alert' as const }
    : priority === 'low'
      ? { tone: 'quiet' as const }
      : {}),
}));

export function PrioritySelect({
  label = 'Priority',
  hideLabel = false,
  value,
  onChange,
  isDisabled = false,
  compact = false,
  className,
}: {
  label?: string;
  hideLabel?: boolean;
  value: TaskPriority;
  onChange: (next: TaskPriority) => void;
  isDisabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <Select
      label={label}
      hideLabel={hideLabel}
      options={OPTIONS}
      value={value}
      onChange={onChange}
      isDisabled={isDisabled}
      compact={compact}
      {...(className !== undefined ? { className } : {})}
    />
  );
}
