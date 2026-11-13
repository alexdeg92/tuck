import { Plus } from 'lucide-react';
import { memo, useRef, useState, type ReactNode } from 'react';
import { Outlet, useMatch } from 'react-router';
import recipes from '../../../styles/recipes.module.css';
import { AccountBar } from '../../../shared/ui/AccountBar';
import { usePhoneTier } from '../../../shared/lib/usePhoneTier';
import { AppBar, AppShell, FrameBar, FrameBody, Pane, Workspace } from '../../../shared/ui/Frame';
import { EmptyState, ErrorState, SkeletonList } from '../../../shared/ui/States';
import { VersionFooter } from '../../../shared/ui/VersionFooter';
import { NotesPlaceholder } from '../components/NotesPlaceholder';
import { TaskDraftRow } from '../components/TaskDraftRow';
import { TaskList } from '../components/TaskList';
import { RetryToast } from '../components/ResultToasts';
import { splitByStatus } from '../groups';
import { usePendingTaskTitles, useTasks } from '../hooks';
import { NoteBarContext } from '../noteBar';
import type { ListSearch, SearchResults } from '../searchSlots';
import { useRowDeletion } from '../useRowDeletion';
import styles from '../components/TaskList.module.css';

type Draft = { seed: string; focus: number };

export function TaskListPage({
  email,
  onSignOut,
  onSignOutEverywhere,
  search,
  footer,
}: {
  email: string;
  onSignOut: () => void;
  onSignOutEverywhere: () => void;
  search: ListSearch;
  /** Kept under the list, outside its scroller (the app puts the Trash link here). */
  footer?: ReactNode;
}) {
  const detailOpen = useMatch('/tasks/:id') !== null;

  const noteBar = usePhoneTier() && detailOpen;
  const [noteBarSlot, setNoteBarSlot] = useState<HTMLDivElement | null>(null);

  return (
    <AppShell noteBar={noteBar}>
      <AppBar
        note={
          noteBar
            ? {
                bar: <div className={styles.noteBarSlot} ref={setNoteBarSlot} />,
                email,
                onSignOut,
                onSignOutEverywhere,
              }
            : undefined
        }
      >
        <AccountBar email={email} onSignOut={onSignOut} onSignOutEverywhere={onSignOutEverywhere} />
      </AppBar>
      <Workspace detailOpen={detailOpen}>
        <TaskMasterPane search={search} footer={footer} />
        <NoteBarContext value={noteBar ? noteBarSlot : null}>
          {detailOpen ? <Outlet /> : <NotesPlaceholder />}
        </NoteBarContext>
      </Workspace>
      <VersionFooter />
    </AppShell>
  );
}

const TaskMasterPane = memo(function TaskMasterPane({
  search,
  footer,
}: {
  search: ListSearch;
  footer: ReactNode;
}) {
  const query = search.input;
  const debounced = search.q;
  const all = useTasks('');
  const tasks: SearchResults = search.results ?? {
    status: all.status,
    tasks: all.data?.items ?? [],
    error: all.error?.message ?? null,
    retry: () => {
      void all.refetch();
    },
    extras: () => undefined,
  };
  const pendingTitles = usePendingTaskTitles();
  const [draft, setDraft] = useState<Draft | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const deletion = useRowDeletion();

  function beginDraft(seed: string, from: HTMLElement | null) {
    opener.current = from;
    search.setInput('');
    setDraft((current) => ({ seed: current?.seed ?? seed, focus: (current?.focus ?? 0) + 1 }));
  }

  function closeDraft() {
    setDraft(null);
    opener.current?.focus();
  }

  const loaded = tasks.status === 'success';
  const items = tasks.tasks;
  const counts = splitByStatus(items);
  const searching = search.results !== null;
  const caption = searching
    ? `${String(items.length)} ${items.length === 1 ? 'result' : 'results'} · reorder paused`
    : `${String(counts.open.length)} open · ${String(counts.done.length)} completed`;

  return (
    <Pane pane="master" label="Task list">
      {}
      <h1 className="srOnly">Tasks</h1>
      <FrameBar>
        <div className={styles.searchRow}>
          {search.bar}
          <button
            type="button"
            className={styles.newTask}
            aria-label="New task"
            onClick={(event) => {
              beginDraft('', event.currentTarget);
            }}
          >
            <Plus aria-hidden="true" />
            <span className={styles.newTaskLabel}>New task</span>
          </button>
        </div>
        <div className="listCaption">
          <span>{loaded ? caption : '\u00a0'}</span>
        </div>
      </FrameBar>
      <FrameBody className="masterBody">
        {search.notice}
        {draft !== null ? (
          <div hidden={query !== ''}>
            <TaskDraftRow
              key={draft.seed}
              initialTitle={draft.seed}
              focusSignal={draft.focus}
              onClose={closeDraft}
            />
          </div>
        ) : null}
        {query.trim() !== '' && draft === null ? (
          <button
            type="button"
            className="createSearchResult"
            onClick={(event) => {
              beginDraft(query.trim(), event.currentTarget);
            }}
          >
            <Plus className={recipes.buttonIcon} aria-hidden="true" />
            <span>Create task “{query.trim()}”</span>
          </button>
        ) : null}
        {tasks.status === 'pending' ? <SkeletonList /> : null}
        {tasks.status === 'error' ? (
          <ErrorState message={tasks.error ?? 'Could not load tasks'} onRetry={tasks.retry} />
        ) : null}
        {pendingTitles.length > 0 ? (
          <ul className={recipes.taskList} aria-label="Saving tasks">
            {pendingTitles.map((title) => (
              <li key={title} className={styles.pending} aria-busy="true">
                {title}
                <span className={styles.pendingHint}>Saving…</span>
              </li>
            ))}
          </ul>
        ) : null}
        {loaded ? (
          <TaskList
            tasks={items}
            q={debounced}
            deletion={deletion}
            extras={tasks.extras}
            empty={
              pendingTitles.length > 0 ? null : searching ? (
                <EmptyState
                  title={`No tasks match “${debounced}”`}
                  description="Try a different search."
                />
              ) : (
                <EmptyState
                  title="No tasks yet"
                  description="Choose New task to add your first one."
                />
              )
            }
          />
        ) : null}
      </FrameBody>
      {footer !== undefined && footer !== null ? (
        <div className={styles.listFooter}>{footer}</div>
      ) : null}
      {deletion.failed !== null ? (
        <RetryToast
          message={`Could not move “${deletion.failed.title}” to the trash.`}
          onRetry={() => {
            if (deletion.failed !== null) deletion.send(deletion.failed);
          }}
        />
      ) : null}
    </Pane>
  );
});
