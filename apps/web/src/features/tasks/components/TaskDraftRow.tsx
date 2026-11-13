import { CreateTaskInput, type TaskPriority } from '@todo/contracts';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { isApiRequestError } from '../../../shared/lib/apiError';
import { useCreateTask } from '../hooks';
import { PrioritySelect } from './PrioritySelect';

export function TaskDraftRow({
  initialTitle = '',
  focusSignal = 0,
  onClose,
}: {
  initialTitle?: string;

  focusSignal?: number;
  onClose: () => void;
}) {
  const createTask = useCreateTask();
  const [title, setTitle] = useState(initialTitle);
  const [priority, setPriority] = useState<TaskPriority>('medium');
  const [failure, setFailure] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const parsed = CreateTaskInput.safeParse({ title, priority });
  const busy = createTask.isPending;

  useEffect(() => {
    inputRef.current?.focus();
  }, [focusSignal]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.success || busy) return;
    setFailure(null);
    try {
      await createTask.mutateAsync(parsed.data);
      onClose();
    } catch (error) {
      setFailure(isApiRequestError(error) ? error.apiError.message : 'Could not create the task');
      inputRef.current?.focus();
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="draftHost">
      {}
      <form className="draftForm" onSubmit={(event) => void submit(event)} onKeyDown={onKeyDown}>
        <span className="draftPlaceholder" aria-hidden="true" />
        <input
          ref={inputRef}
          className="draftTitle"
          aria-label="New task"
          placeholder="Task title"
          maxLength={200}
          autoComplete="off"
          enterKeyHint="done"
          value={title}
          disabled={busy}
          aria-busy={busy}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
        <button
          type="submit"
          className="draftCreate"
          aria-label="Create task"
          disabled={!parsed.success || busy}
        >
          <Check aria-hidden="true" />
        </button>
        <div className="draftMeta">
          <PrioritySelect
            className="draftPriority"
            label="New task priority"
            hideLabel
            compact
            value={priority}
            isDisabled={busy}
            onChange={setPriority}
          />
          <span className="draftHint">Enter to create</span>
        </div>
        <button type="button" className="draftCancel" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        {failure !== null ? (
          <p role="alert" style={{ gridColumn: '1 / -1' }}>
            {failure}
          </p>
        ) : null}
      </form>
    </div>
  );
}
