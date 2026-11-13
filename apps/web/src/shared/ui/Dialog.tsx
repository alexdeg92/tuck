import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import recipes from '../../styles/recipes.module.css';
import { cx } from '../lib/cx';
import { Button } from './Button';

export function Dialog({
  title,
  children,
  confirmLabel,
  onConfirm,
  onClose,
  busy = false,
  danger = false,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
  busy?: boolean;
  danger?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialogRef.current;
    if (!node) return;

    if (!node.open) {
      node.showModal();
    }

    const focusCancel = () => {
      node.querySelector<HTMLElement>('[data-dialog-cancel]')?.focus();
    };
    focusCancel();

    const frame = requestAnimationFrame(focusCancel);

    return () => {
      cancelAnimationFrame(frame);
      if (node.open) {
        node.close();
      }
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={cx(recipes.material, recipes.dialog)}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className={recipes.dialogHead}>
        <h2 id={titleId} className={recipes.dialogTitle}>
          {title}
        </h2>
        <button
          type="button"
          className="plainIcon"
          aria-label="Close dialog"
          onClick={onClose}
          disabled={busy}
        >
          <X aria-hidden="true" className="flowIcon" />
        </button>
      </div>
      <div className={recipes.dialogBody}>{children}</div>
      <div className={recipes.dialogFoot}>
        <Button variant="secondary" data-dialog-cancel="" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={danger ? 'danger' : 'primary'}
          onClick={onConfirm}
          disabled={busy}
          aria-busy={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
