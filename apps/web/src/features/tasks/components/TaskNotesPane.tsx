import { TaskTitle, type Task } from '@todo/contracts';
import { AlertCircle, ArrowLeft, Check, Loader2, RotateCw, Trash2 } from 'lucide-react';
import {
  useCallback,
  useContext,
  useEffect,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { Button } from '../../../shared/ui/Button';
import { BackLink, FrameBody, FrameHead, Pane } from '../../../shared/ui/Frame';
import { flushPendingSaves, type NoteSaver, type SaveState } from '../autosave';
import { useDeleteTask } from '../hooks';
import { NoteBarContext } from '../noteBar';
import type { NotesSlots } from '../searchSlots';
import { useNoteAutosave } from '../useNoteAutosave';
import { TaskSettings } from './TaskSettings';
import styles from './TaskNotesPane.module.css';

type NotesValues = { title: string; notes: string };

const TITLE_MESSAGE = 'A task needs a title.';

export function TaskNotesPane({
  task,
  backTo,
  fallback = null,
  notice = null,
  ownerId,
  finder,
  reading,
}: NotesSlots & {
  task: Task | undefined;
  backTo: string;

  ownerId?: string | undefined;
  fallback?: ReactNode;

  notice?: ReactNode;
}) {
  const [actions, setActions] = useState<HTMLDivElement | null>(null);

  const bar = useContext(NoteBarContext);

  return (
    <Pane
      pane="detail"
      label="Task notes"
      className={cx(recipes.material, recipes.panel, 'notesFrame')}
    >
      {bar ? (
        createPortal(
          <div className={styles.barHead}>
            <BackLink to={backTo} label="Back to tasks">
              <ArrowLeft className="flowIcon" aria-hidden="true" />
              <span className={styles.barBackLabel}>Tasks</span>
            </BackLink>
            <div className={cx('noteActions', styles.barActions)} ref={setActions} />
          </div>,
          bar,
        )
      ) : (
        <FrameHead
          className={cx(recipes.material, recipes.frameHead, recipes.detailHead, 'notesHead')}
        >
          <BackLink to={backTo}>
            <ArrowLeft className="flowIcon" aria-hidden="true" />
            <span>Tasks</span>
          </BackLink>
          <div className="noteActions" ref={setActions} />
        </FrameHead>
      )}
      {task ? finder : null}
      <FrameBody className="notesBody">
        {task ? notice : null}
        {task ? reading : null}
        {task ? (
          <TaskNoteEditor
            key={task.id}
            task={task}
            ownerId={ownerId}
            actions={actions}
            hidden={reading !== undefined}
          />
        ) : (
          fallback
        )}
      </FrameBody>
    </Pane>
  );
}

const STATUS_TEXT: Record<SaveState['kind'], string> = {
  saved: 'Saved',
  editing: 'Editing…',
  saving: 'Saving…',
  restored: 'Restored unsaved changes',
  offline: 'Not saved',
  failed: 'Couldn’t save',
  retrying: 'Saving…',
  conflict: 'Not saved',
};

const ANNOUNCED: Partial<Record<SaveState['kind'], string>> = {
  saved: 'All changes saved.',
  restored: 'Unsaved changes from this device were restored.',
  offline: 'Offline. Changes will save when you’re back.',
  failed: 'Changes could not be saved. Trying again.',

  retrying: 'Changes could not be saved. Trying again.',
};

const SAVED_DWELL_MS = 1500;

function useSaveConfirmation(kind: SaveState['kind']): boolean {
  const [previous, setPrevious] = useState(kind);
  const [savedCount, setSavedCount] = useState(0);
  const [showing, setShowing] = useState(false);

  if (kind !== previous) {
    setPrevious(kind);
    if (kind === 'saved') {
      setSavedCount((count) => count + 1);
      setShowing(true);
    }
  }
  useEffect(() => {
    if (savedCount === 0) return undefined;
    const timer = setTimeout(() => {
      setShowing(false);
    }, SAVED_DWELL_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [savedCount]);
  return showing;
}

function SaveStatus({
  state,
  invalid,
  saver,
}: {
  state: SaveState;
  invalid: boolean;
  saver: NoteSaver;
}) {
  const confirming = useSaveConfirmation(state.kind);
  const justSaved = confirming && state.kind === 'saved';

  const echo = confirming && state.kind === 'editing' && !invalid;
  const shown = invalid && state.kind !== 'failed' ? 'Not saved' : STATUS_TEXT[state.kind];
  return (
    <span
      className={cx('noteStatus', styles.status)}
      data-state={invalid ? 'invalid' : state.kind}
      data-result={justSaved && !invalid ? 'saved' : undefined}
    >
      <span key={shown} className={styles.statusText}>
        {state.kind === 'saved' && !invalid ? (
          <Check className={cx(styles.statusIcon, styles.savedIcon)} aria-hidden="true" />
        ) : null}
        {state.kind === 'saving' ? (
          <Loader2 className={cx(styles.statusIcon, recipes.spinner)} aria-hidden="true" />
        ) : null}
        {shown}
      </span>
      <span className="srOnly" aria-live="polite">
        {invalid ? 'Not saved. A task needs a title.' : (ANNOUNCED[state.kind] ?? '')}
      </span>
      {echo ? (
        <span className={styles.savedEcho}>
          <Check className={cx(styles.statusIcon, styles.savedIcon)} aria-hidden="true" />
          Earlier changes saved
        </span>
      ) : null}
      {state.kind === 'failed' || state.kind === 'retrying' ? (
        <Button
          variant="ghost"
          className={styles.retry}
          onClick={saver.retry}
          aria-busy={state.kind === 'retrying'}
          aria-disabled={state.kind === 'retrying'}
          busyLabel="Retrying…"
        >
          <RotateCw className={recipes.buttonIcon} aria-hidden="true" />
          <span className={recipes.label}>Retry</span>
        </Button>
      ) : null}
    </span>
  );
}

const CONFLICT_EXIT_FALLBACK_MS = 400;

function ConflictChoice({
  leaving,
  onKeepMine,
  onUseTheirs,
  onLeft,
}: {
  leaving: boolean;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onLeft: () => void;
}) {
  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(onLeft, CONFLICT_EXIT_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [leaving, onLeft]);
  return (
    <div
      className={styles.conflict}
      role={leaving ? undefined : 'alert'}
      data-phase={leaving ? 'leaving' : undefined}
      inert={leaving}
      onAnimationEnd={(event) => {
        if (leaving && event.target === event.currentTarget) onLeft();
      }}
    >
      <AlertCircle className={styles.conflictIcon} aria-hidden="true" />
      <div className={styles.conflictText}>
        <p>This note changed elsewhere. Choose which version to keep.</p>
        <p>
          Keep mine replaces the saved version with your changes. Use theirs replaces your unsaved
          changes with the saved version.
        </p>
      </div>
      <div className={styles.conflictActions}>
        <Button variant="secondary" onClick={onKeepMine}>
          <span className={recipes.label}>Keep mine</span>
        </Button>
        <Button variant="ghost" onClick={onUseTheirs}>
          <span className={recipes.label}>Use theirs</span>
        </Button>
      </div>
    </div>
  );
}

function SaveNotice({ state, durable }: { state: SaveState; durable: boolean }) {
  let message: string | null = null;
  if (state.kind === 'offline') {
    message = durable
      ? 'Offline. Your changes are kept on this device and will save when you’re back.'
      : 'Offline. Your changes will save when you’re back.';
  } else if (state.kind === 'failed') {
    message = durable
      ? 'Your changes are kept on this device. Trying again automatically.'
      : 'Your changes are kept in this tab. Trying again automatically.';
  }
  return (
    <>
      {message !== null ? <p className={styles.notice}>{message}</p> : null}
      {!durable ? (
        <p className={styles.notice}>
          Changes are only kept in this tab. Device recovery isn’t available.
        </p>
      ) : null}
    </>
  );
}

function TaskNoteEditor({
  task,
  ownerId,
  actions,
  hidden,
}: {
  task: Task;
  ownerId: string | undefined;
  actions: HTMLElement | null;

  hidden: boolean;
}) {
  const deleteTask = useDeleteTask();
  const [moveFailed, setMoveFailed] = useState(false);

  /** No confirmation (Undo or the Trash bring it back); unsent edits are saved first. */
  function moveToTrash() {
    setMoveFailed(false);
    flushPendingSaves()
      .then(() => deleteTask.mutateAsync(task.id))
      .catch(() => {
        setMoveFailed(true);
      });
  }
  const [titleInvalid, setTitleInvalid] = useState(false);
  const { register, getValues, reset, setValue, setFocus } = useForm<NotesValues>();

  const [leaving, setLeaving] = useState(false);

  const resolve = (choice: () => void) => {
    choice();
    setLeaving(true);
  };

  useEffect(() => {
    if (leaving) setFocus('notes');
  }, [leaving, setFocus]);

  const showServerFields = useCallback(
    (fields: Partial<NotesValues>) => {
      for (const [name, value] of Object.entries(fields)) {
        if (name === 'title' || name === 'notes') setValue(name, value);
      }
    },
    [setValue],
  );
  const { saver, state } = useNoteAutosave(task, ownerId, showServerFields);

  const [initial] = useState(saver.fields);

  const sendToSaver = () => {
    const values = getValues();
    const title = TaskTitle.safeParse(values.title);
    setTitleInvalid(!title.success);
    saver.edit({ notes: values.notes, ...(title.success ? { title: title.data } : {}) });
  };
  const composition = {
    onCompositionStart: () => {
      saver.setComposing(true);
    },
    onCompositionEnd: () => {
      saver.setComposing(false);
      sendToSaver();
    },
  };

  const flush = () => {
    void saver.flush();
  };

  function onTitleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();

    event.currentTarget.blur();
  }

  const headActions = (
    <>
      <SaveStatus state={state} invalid={titleInvalid} saver={saver} />
      <button
        type="button"
        className="plainIcon"
        aria-label={`Move “${task.title}” to trash`}
        title="Move to trash"
        disabled={deleteTask.isPending}
        onClick={moveToTrash}
      >
        <Trash2 aria-hidden="true" className="flowIcon" />
      </button>
      <TaskSettings task={task} onDelete={moveToTrash} />
    </>
  );

  return (
    <>
      {actions ? createPortal(headActions, actions) : null}
      <form
        hidden={hidden}
        className="noteCanvas"
        onSubmit={(event) => {
          event.preventDefault();
          flush();
        }}
      >
        {}
        <SaveNotice state={state} durable={saver.isDurable()} />
        {state.kind === 'conflict' || leaving ? (
          <ConflictChoice
            leaving={state.kind !== 'conflict'}
            onKeepMine={() => {
              resolve(saver.keepMine);
            }}
            onUseTheirs={() => {
              resolve(() => {
                reset(saver.useTheirs());
                setTitleInvalid(false);
              });
            }}
            onLeft={() => {
              setLeaving(false);
            }}
          />
        ) : null}
        <h2 className="noteHeading" tabIndex={-1}>
          <label className="srOnly" htmlFor="note-title">
            Title
          </label>
          <textarea
            id="note-title"
            className="noteTitle"
            rows={1}
            maxLength={200}
            aria-invalid={titleInvalid}
            aria-describedby={titleInvalid ? 'note-title-error' : undefined}
            defaultValue={initial.title}
            {...register('title', { onBlur: flush, onChange: sendToSaver })}
            {...composition}
            onKeyDown={onTitleKeyDown}
          />
        </h2>
        {titleInvalid ? (
          <p id="note-title-error" className={styles.fieldError}>
            <AlertCircle aria-hidden="true" />
            {TITLE_MESSAGE}
          </p>
        ) : null}
        <label className="srOnly" htmlFor="note-content">
          Notes
        </label>
        <textarea
          id="note-content"
          className="noteEditor"
          rows={8}
          maxLength={5000}
          placeholder="Add notes…"
          defaultValue={initial.notes}
          {...register('notes', { onBlur: flush, onChange: sendToSaver })}
          {...composition}
        />
      </form>
      {moveFailed ? (
        <p className="noteStatus" role="alert">
          Could not move this task to the trash.{' '}
          <Button variant="ghost" onClick={moveToTrash}>
            Retry
          </Button>
        </p>
      ) : null}
    </>
  );
}
