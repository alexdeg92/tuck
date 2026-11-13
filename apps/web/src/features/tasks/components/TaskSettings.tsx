import { MAX_DUE_DATE, MIN_DUE_DATE, type Task, type UpdateTaskInput } from '@todo/contracts';
import { MoreHorizontal, SlidersHorizontal, Trash2, X } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type ToggleEvent,
} from 'react';
import { UNSAFE_PortalProvider } from 'react-aria';
import { useLocation, useMatch, useNavigate } from 'react-router';
import recipes from '../../../styles/recipes.module.css';
import { cx } from '../../../shared/lib/cx';
import { usePhoneTier } from '../../../shared/lib/usePhoneTier';
import { CheckGlyph } from '../../../shared/ui/CheckGlyph';
import { DatePicker } from '../../../shared/ui/DatePicker';
import { useToggleTaskStatus, useUpdateTask } from '../hooks';
import { PrioritySelect } from './PrioritySelect';

const IDLE_NOTICE = 'Changes apply to this task.';

function useDraft<T>(server: T): { value: T; set: (value: T) => void; clear: () => void } {
  const [draft, setDraft] = useState<{ value: T } | null>(null);
  return {
    value: draft === null ? server : draft.value,
    set: (value) => {
      setDraft({ value });
    },
    clear: () => {
      setDraft(null);
    },
  };
}

export type TaskSettingsHandle = {
  open: () => void;
  close: () => void;
};

type TaskSettingsProps = {
  task: Task;
  onDelete: () => void;
  /** Accessible name for the trigger. Notes chrome uses Task settings; list rows use Task options. */
  triggerLabel?: string;
  triggerClassName?: string;
  triggerIcon?: ReactNode;
};

/**
 * One options / settings surface: task title for context, Open notes, Done, Priority, Due, then
 * Move to trash separated at the foot. Shared by the notes chrome, the row options button, and row hold.
 * Opening the sheet never navigates into notes or discards another task's unsaved editor.
 */
export const TaskSettings = forwardRef<TaskSettingsHandle, TaskSettingsProps>(function TaskSettings(
  {
    task,
    onDelete,
    triggerLabel = 'Task settings',
    triggerClassName = 'taskSettingsButton',
    triggerIcon,
  },
  ref,
) {
  const popoverId = useId();
  const popoverRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const [opened, setOpened] = useState(false);
  const [notice, setNotice] = useState(IDLE_NOTICE);
  const updateTask = useUpdateTask();
  const toggleStatus = useToggleTaskStatus();
  const done = useDraft(task.status === 'done');
  const priority = useDraft(task.priority);
  const dueDate = useDraft(task.dueDate);
  const phone = usePhoneTier();
  const navigate = useNavigate();
  const location = useLocation();
  const viewingNotes = useMatch(`/tasks/${task.id}`) !== null;

  useImperativeHandle(ref, () => ({
    open: () => {
      popoverRef.current?.showPopover();
    },
    close: () => {
      popoverRef.current?.hidePopover();
    },
  }));

  useEffect(() => {
    if (!open || phone) return;
    const place = () => {
      const popover = popoverRef.current;
      const trigger = triggerRef.current;
      if (!popover || !trigger) return;
      const rect = trigger.getBoundingClientRect();
      const margin = 16;
      const left = Math.min(
        rect.right - popover.offsetWidth,
        window.innerWidth - popover.offsetWidth - margin,
      );
      const top = Math.min(rect.bottom + 8, window.innerHeight - popover.offsetHeight - margin);
      popover.style.left = `${String(Math.max(margin, left))}px`;
      popover.style.top = `${String(Math.max(margin, top))}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('resize', place);
    };
  }, [open, phone]);

  function apply(change: Promise<unknown>, saved: string, settle: () => void) {
    setNotice('Saving…');
    change.then(
      () => {
        settle();
        setNotice(saved);
      },
      () => {
        settle();
        setNotice('Could not save that change.');
      },
    );
  }

  function update(input: UpdateTaskInput, saved: string, settle: () => void) {
    apply(updateTask.mutateAsync({ id: task.id, input }), saved, settle);
  }

  function closePopover() {
    if (open) popoverRef.current?.hidePopover();
  }

  function openNotes() {
    closePopover();
    void navigate({
      pathname: `/tasks/${task.id}`,
      search: location.search,
    });
  }

  const icon =
    triggerIcon ??
    (triggerClassName.includes('rowMore') ? (
      <MoreHorizontal aria-hidden="true" className="flowIcon" />
    ) : (
      <SlidersHorizontal aria-hidden="true" className="flowIcon" />
    ));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={triggerLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        popoverTarget={popoverId}
      >
        {icon}
        {triggerClassName === 'taskSettingsButton' ? (
          <span className="noteSettingsLabel">Task settings</span>
        ) : null}
      </button>
      <section
        ref={popoverRef}
        id={popoverId}
        className={cx(recipes.material, recipes.panel, 'settingsPopover')}
        popover="auto"
        role="dialog"
        aria-label="Task settings"
        onToggle={(event: ToggleEvent) => {
          setOpen(event.newState === 'open');
          if (event.newState === 'open') {
            setOpened(true);
            setNotice(IDLE_NOTICE);

            bodyRef.current
              ?.querySelector<HTMLElement>('button, input, select')
              ?.focus({ preventScroll: true });
            return;
          }

          const active = document.activeElement;
          if (
            active === null ||
            active === document.body ||
            popoverRef.current?.contains(active) === true
          ) {
            triggerRef.current?.focus({ preventScroll: true });
          }
        }}
      >
        {}
        <UNSAFE_PortalProvider getContainer={() => popoverRef.current}>
          <header className="settingsHead">
            <h2>Task settings</h2>
            <button
              type="button"
              className="plainIcon"
              aria-label="Close task settings"
              onClick={() => {
                closePopover();
              }}
            >
              <X aria-hidden="true" className="flowIcon" />
            </button>
          </header>
          <div ref={bodyRef} className="settingsBody">
            <p className="settingsTaskName">{task.title}</p>
            {viewingNotes ? null : (
              <button type="button" className="sheetOpenNotes" onClick={openNotes}>
                Open notes
              </button>
            )}
            <label className={recipes.checkLabel}>
              <span className={recipes.checkControl}>
                <input
                  className={recipes.checkInput}
                  type="checkbox"
                  checked={done.value}
                  disabled={toggleStatus.isPending}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    done.set(checked);
                    apply(
                      toggleStatus.mutateAsync({ id: task.id, done: checked }),
                      checked ? 'Marked as done.' : 'Marked as not done.',
                      done.clear,
                    );
                  }}
                />
                <span className={cx(recipes.material, recipes.checkbox)}>
                  <CheckGlyph />
                </span>
              </span>
              Mark as done
            </label>
            {opened ? (
              <>
                <PrioritySelect
                  value={priority.value}
                  onChange={(next) => {
                    priority.set(next);
                    update({ priority: next }, 'Priority updated.', priority.clear);
                  }}
                />
                <DatePicker
                  label="Due date"
                  min={MIN_DUE_DATE}
                  max={MAX_DUE_DATE}
                  value={dueDate.value}
                  onChange={(next) => {
                    dueDate.set(next);
                    update(
                      { dueDate: next },
                      next === null ? 'Due date cleared.' : 'Due date updated.',
                      dueDate.clear,
                    );
                  }}
                />
              </>
            ) : null}
            <span className="settingsStatus" aria-live="polite">
              {notice}
            </span>
          </div>
          <footer className="settingsFoot">
            <button
              type="button"
              className="deleteTaskAction"
              onClick={() => {
                closePopover();
                onDelete();
              }}
            >
              <Trash2 aria-hidden="true" className="flowIcon" />
              Move to trash
            </button>
          </footer>
        </UNSAFE_PortalProvider>
      </section>
    </>
  );
});
