import type { TrashedTask } from '@todo/contracts';
import { TrashList } from '@todo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TrashDetailPage } from './TrashDetailPage';
import { TrashPage } from './TrashPage';

const NOW = new Date('2026-11-12T10:00:00.000Z');
const [report, venue] = TrashList.parse(fixtures.trashList).items as [TrashedTask, TrashedTask];

/** A fake API holding a trash; it records every request as "METHOD url". */
const serve = (initial: TrashedTask[], { failList = false } = {}) => {
  const state = { trash: [...initial], requests: [] as string[] };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      state.requests.push(`${method} ${url}`);
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      if (method === 'GET' && url === '/api/trash') {
        return Promise.resolve(
          failList
            ? jsonResponse({ error: { code: 'INTERNAL', message: 'Internal error' } }, 500)
            : jsonResponse({ items: state.trash }),
        );
      }
      const restore = /^\/api\/tasks\/([^/]+)\/restore$/.exec(url);
      if (method === 'POST' && restore !== null) {
        const task = state.trash.find(({ id }) => id === restore[1]);
        state.trash = state.trash.filter((item) => item !== task);
        return Promise.resolve(
          task === undefined
            ? jsonResponse(fixtures.errorNotFound, 404)
            : jsonResponse({ ...task, deletedAt: undefined, purgeAt: undefined }),
        );
      }
      if (method === 'DELETE' && url === '/api/trash') {
        state.trash = [];
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const forever = /^\/api\/trash\/([^/]+)$/.exec(url);
      if (method === 'DELETE' && forever !== null) {
        state.trash = state.trash.filter(({ id }) => id !== forever[1]);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    }),
  );
  return state;
};

const renderTrash = (route = '/trash') =>
  renderWithProviders(
    <Routes>
      <Route path="/trash" element={<TrashPage />}>
        <Route path=":id" element={<TrashDetailPage />} />
      </Route>
      <Route path="/tasks" element={<p>Task list</p>} />
    </Routes>,
    { route },
  );

const rows = () =>
  within(screen.getByRole('list', { name: 'Trashed tasks' })).getAllByRole('listitem');

describe('TrashPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('lists the trash in server order with the purge countdown from purgeAt', async () => {
    serve([report, venue]);
    renderTrash();

    expect(await screen.findByRole('heading', { name: 'Trash' })).toBeInTheDocument();
    await waitFor(() => {
      expect(rows()).toHaveLength(2);
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Draft the quarterly report'),
      expect.stringContaining('Book the venue'),
    ]);
    expect(within(rows()[0] as HTMLElement).getByText('Deletes in 30 days')).toBeInTheDocument();
    expect(within(rows()[1] as HTMLElement).getByText('Deletes in 29 days')).toBeInTheDocument();
    expect(screen.getByText('Tasks are kept here for 30 days.')).toBeInTheDocument();
  });

  it('shows the empty state, without Empty trash, when nothing is in the trash', async () => {
    serve([]);
    renderTrash();

    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
    expect(screen.getByText('Moved tasks will appear here for 30 days.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to tasks' })).toHaveAttribute('href', '/tasks');
    expect(screen.queryByRole('button', { name: 'Empty trash' })).not.toBeInTheDocument();
  });

  it('restores a task: the server takes it out of the trash, and the list refreshes', async () => {
    const user = userEvent.setup();
    const server = serve([report, venue]);
    renderTrash();

    await user.click(
      await screen.findByRole('button', { name: 'Restore “Draft the quarterly report”' }),
    );

    expect(server.requests).toContain(`POST /api/tasks/${report.id}/restore`);
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
  });

  it('deletes forever only after the custom confirmation', async () => {
    const user = userEvent.setup();
    const server = serve([report, venue]);
    renderTrash();

    await user.click(
      await screen.findByRole('button', { name: 'Delete “Book the venue” forever' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Delete this task forever?' });
    expect(within(dialog).getByText(/Book the venue/)).toBeInTheDocument();
    expect(server.requests).not.toContain(`DELETE /api/trash/${venue.id}`);

    await user.click(within(dialog).getByRole('button', { name: 'Delete forever' }));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(server.requests).toContain(`DELETE /api/trash/${venue.id}`);
  });

  it('empties the trash after a confirmation that names the count', async () => {
    const user = userEvent.setup();
    const server = serve([report, venue]);
    renderTrash();

    await user.click(await screen.findByRole('button', { name: 'Empty trash' }));
    const dialog = screen.getByRole('dialog', { name: 'Empty Trash?' });
    expect(within(dialog).getByText(/2 tasks/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Empty trash' }));

    expect(await screen.findByText('Trash is empty')).toBeInTheDocument();
    expect(server.requests).toContain('DELETE /api/trash');
  });

  it('says so and offers Retry when the trash cannot load', async () => {
    serve([report], { failList: true });
    renderTrash();

    expect(await screen.findByText("Couldn't load Trash")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('shows a trashed task read-only from the trash list, without fetching the task', async () => {
    const server = serve([report, venue]);
    renderTrash(`/trash/${report.id}`);

    const detail = await screen.findByRole('region', { name: 'Trashed task' });
    expect(
      await within(detail).findByRole('heading', { name: 'Draft the quarterly report' }),
    ).toBeInTheDocument();
    expect(within(detail).getByText(/Pull the numbers/)).toBeInTheDocument();
    expect(within(detail).getByText('1 of 3 checklist items complete')).toBeInTheDocument();
    expect(
      within(detail).getByText('Restore this task to edit it or view its checklist.'),
    ).toBeInTheDocument();
    expect(within(detail).queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      server.requests.filter((request) => request.includes(`/api/tasks/${report.id}`)),
    ).toEqual([]);
  });

  it('shows a placeholder when the selected task is no longer in the trash', async () => {
    serve([venue]);
    renderTrash(`/trash/${report.id}`);

    expect(await screen.findByText('This task is no longer in Trash.')).toBeInTheDocument();
  });
});
