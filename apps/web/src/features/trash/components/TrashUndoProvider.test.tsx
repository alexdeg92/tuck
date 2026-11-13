import type { TrashedTask } from '@todo/contracts';
import { TrashList } from '@todo/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useTrashUndo } from '../../../shared/lib/trashUndo';
import { NotificationProvider } from '../../../shared/ui/NotificationStack';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TrashUndoProvider } from './TrashUndoProvider';

const [report, venue] = TrashList.parse(fixtures.trashList).items as [TrashedTask, TrashedTask];

/** Stands in for the tasks feature: it only says what it moved to the trash. */
function Mover({ task }: { task: TrashedTask }) {
  const { trashed } = useTrashUndo();
  return (
    <button
      type="button"
      onClick={() => {
        trashed(task);
      }}
    >{`Trash ${task.title}`}</button>
  );
}

const serve = (restore: 'ok' | 'gone') => {
  const requests: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.endsWith('/restore')) {
        return Promise.resolve(
          restore === 'ok'
            ? jsonResponse({ ...report, deletedAt: undefined, purgeAt: undefined })
            : jsonResponse(fixtures.errorNotFound, 404),
        );
      }
      return Promise.resolve(jsonResponse({ items: [] }));
    }),
  );
  return requests;
};

const renderWithUndo = () =>
  renderWithProviders(
    <NotificationProvider>
      <TrashUndoProvider>
        <Mover task={report} />
        <Mover task={venue} />
      </TrashUndoProvider>
    </NotificationProvider>,
  );

describe('TrashUndoProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers Undo for a task moved to the trash, and Undo restores it through the server', async () => {
    const user = userEvent.setup();
    const requests = serve('ok');
    renderWithUndo();

    await user.click(screen.getByRole('button', { name: `Trash ${report.title}` }));
    expect(await screen.findByText('Moved to trash')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('Restored')).toBeInTheDocument();
    expect(requests).toContain(`POST /api/tasks/${report.id}/restore`);
  });

  it('says so when the task is no longer in the trash', async () => {
    const user = userEvent.setup();
    serve('gone');
    renderWithUndo();

    await user.click(screen.getByRole('button', { name: `Trash ${report.title}` }));
    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    expect(await screen.findByText('This task is no longer in Trash.')).toBeInTheDocument();
  });

  it('offers Undo for the most recent move only', async () => {
    const user = userEvent.setup();
    const requests = serve('ok');
    renderWithUndo();

    await user.click(screen.getByRole('button', { name: `Trash ${report.title}` }));
    await user.click(screen.getByRole('button', { name: `Trash ${venue.title}` }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Undo' })).toHaveLength(1);
    });
    await act(async () => {
      await user.click(screen.getByRole('button', { name: 'Undo' }));
    });

    await waitFor(() => {
      expect(requests).toContain(`POST /api/tasks/${venue.id}/restore`);
    });
    expect(requests).not.toContain(`POST /api/tasks/${report.id}/restore`);
  });
});
