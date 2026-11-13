import { useMemo, useState, type ReactNode } from 'react';
import { TaskListPage } from '../pages/TaskListPage';
import type { SearchResults } from '../searchSlots';

export function TaskListPageWithSearch({
  onSignOut = () => undefined,
  onSignOutEverywhere = () => undefined,
  q = '',
  results = null,
  footer,
}: {
  onSignOut?: () => void;
  onSignOutEverywhere?: () => void;
  q?: string;
  results?: SearchResults | null;
  footer?: ReactNode;
}) {
  const [input, setInput] = useState(q);

  const search = useMemo(
    () => ({
      input,
      setInput,
      q,
      results,
      notice: null,
      bar: (
        <input
          type="search"
          aria-label="Search tasks"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
          }}
        />
      ),
    }),
    [input, q, results],
  );
  return (
    <TaskListPage
      email="demo@example.com"
      onSignOut={onSignOut}
      onSignOutEverywhere={onSignOutEverywhere}
      search={search}
      footer={footer}
    />
  );
}
