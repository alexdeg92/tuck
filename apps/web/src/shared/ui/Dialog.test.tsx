import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

function DeleteConfirmHost() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
      >
        Delete
      </button>
      {open ? (
        <Dialog
          title="Delete task?"
          confirmLabel="Delete task"
          danger
          onClose={() => {
            setOpen(false);
          }}
          onConfirm={() => {
            setOpen(false);
          }}
        >
          This cannot be undone.
        </Dialog>
      ) : null}
    </>
  );
}

describe('Dialog', () => {
  it('opens a native modal dialog, focuses Cancel, and closes on cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onConfirm = vi.fn();

    render(
      <>
        <button type="button">Trigger</button>
        <Dialog
          title="Delete task?"
          confirmLabel="Delete"
          danger
          onClose={onClose}
          onConfirm={onConfirm}
        >
          This cannot be undone.
        </Dialog>
      </>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete task?' });
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog).toHaveAttribute('open');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('exposes only its own actions for keyboard users', async () => {
    const user = userEvent.setup();
    render(
      <Dialog title="Confirm" confirmLabel="OK" onClose={vi.fn()} onConfirm={vi.fn()}>
        Body
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: 'Confirm' });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const confirm = screen.getByRole('button', { name: 'OK' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.tab();
    expect(confirm).toHaveFocus();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the trigger after Escape', async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmHost />);

    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Delete task?' });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });

  it('returns focus to the trigger after Cancel', async () => {
    const user = userEvent.setup();
    render(<DeleteConfirmHost />);

    const trigger = screen.getByRole('button', { name: 'Delete' });
    trigger.focus();
    await user.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
    });
  });
});
