import { Task } from '@todo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type * as Sortable from '@dnd-kit/sortable';
import type { ComponentProps } from 'react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse, trashedResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import type * as States from '../../../shared/ui/States';
import { bodyObject } from '../../../test/requests';
import { requestUrl } from '../../../test/url';
import type * as Hooks from '../hooks';
import { TaskListPageWithSearch } from '../test/listPage';
import { TaskDetailPage } from './TaskDetailPage';

const renders = vi.hoisted(() => ({ rows: new Map<string, number>(), search: 0, skeleton: 0 }));

vi.mock('@dnd-kit/sortable', async (importOriginal) => {
  const actual = await importOriginal<typeof Sortable>();
  return {
    ...actual,
    useSortable: (args: Parameters<typeof actual.useSortable>[0]) => {
      const id = String(args.id);
      renders.rows.set(id, (renders.rows.get(id) ?? 0) + 1);
      return actual.useSortable(args);
    },
  };
});

vi.mock('../hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    usePendingTaskTitles: () => {
      renders.search += 1;
      return actual.usePendingTaskTitles();
    },
  };
});

vi.mock('../../../shared/ui/States', async (importOriginal) => {
  const actual = await importOriginal<typeof States>();
  return {
    ...actual,
    SkeletonList: (props: ComponentProps<typeof actual.SkeletonList>) => {
      renders.skeleton += 1;
      return actual.SkeletonList(props);
    },
  };
});

const base = Task.parse(fixtures.taskList.items[0]);
const [a, b, c, d] = (['Alpha', 'Bravo', 'Charlie', 'Delta'] as const).map((title, index) =>
  Task.parse({
    ...base,
    id: `3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9${String(index)}`,
    title,
    notes: `${title} notes`,
    position: `a${String(index)}`,
  }),
) as [Task, Task, Task, Task];

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      if (method === 'DELETE') {
        const trashed = [a, b, c, d].find((task) => url.endsWith(task.id));
        return Promise.resolve(trashedResponse(trashed ?? a));
      }
      if (method === 'PATCH') return Promise.resolve(jsonResponse({ ...a, ...bodyObject(init) }));
      if (url === `/api/tasks/${a.id}`) return Promise.resolve(jsonResponse(a));
      if (url.startsWith('/api/tasks/')) return new Promise<Response>(() => undefined);
      return Promise.resolve(jsonResponse({ items: [a, b, c, d] }));
    }),
  );
}

function patches() {
  return vi
    .mocked(fetch)
    .mock.calls.filter(([, init]) => init?.method === 'PATCH')
    .map(([input, init]) => ({ url: requestUrl(input as RequestInfo), body: bodyObject(init) }));
}

function renderWorkspace(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/tasks" element={<TaskListPageWithSearch />}>
        <Route path=":id" element={<TaskDetailPage />} />
      </Route>
    </Routes>,
    { route },
  );
}

function resetCounts() {
  renders.rows.clear();
  renders.search = 0;
  renders.skeleton = 0;
}

describe('switching the open task', () => {
  beforeEach(resetCounts);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the notes pane and its head, and re-renders only the two rows whose selection changed', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWorkspace(`/tasks/${a.id}`);

    expect(await screen.findByLabelText('Title')).toHaveValue('Alpha');
    const pane = screen.getByRole('region', { name: 'Task notes' });
    const head = within(pane).getByRole('link', { name: 'Tasks' }).parentElement;
    expect(head).not.toBeNull();
    resetCounts();

    await user.click(screen.getByRole('link', { name: 'Bravo' }));

    expect(screen.getByLabelText('Title')).toHaveValue('Bravo');
    expect(screen.getByLabelText('Notes')).toHaveValue('Bravo notes');
    expect(renders.skeleton).toBe(0);

    expect(screen.getByRole('region', { name: 'Task notes' })).toBe(pane);
    expect(within(pane).getByRole('link', { name: 'Tasks' }).parentElement).toBe(head);
    expect(within(pane).getByText('Saved')).toBeInTheDocument();

    expect([...renders.rows.keys()].sort()).toEqual([a.id, b.id].sort());
    expect(renders.rows.get(a.id)).toBe(1);
    expect(renders.rows.get(b.id)).toBeLessThanOrEqual(2);
    expect(renders.search).toBe(0);
    expect(screen.getByRole('link', { name: 'Bravo' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Alpha' })).not.toHaveAttribute('aria-current');
  });

  it('saves what was typed in the task it leaves, and starts the next one clean', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWorkspace(`/tasks/${a.id}`);

    await user.type(await screen.findByLabelText('Notes'), ' draft');
    await user.click(screen.getByRole('link', { name: 'Bravo' }));

    expect(screen.getByLabelText('Notes')).toHaveValue('Bravo notes');
    expect(screen.getByText('Saved')).toBeInTheDocument();
    await waitFor(() => {
      expect(patches()).toEqual([
        {
          url: `/api/tasks/${a.id}`,
          body: { notes: 'Alpha notes draft', expectedUpdatedAt: a.updatedAt },
        },
      ]);
    });
  });

  it('still shows the skeleton for a task the list has not loaded (cold deep link)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return new Promise<Response>(() => undefined);
      }),
    );
    renderWorkspace(`/tasks/${b.id}`);

    expect(await screen.findByRole('region', { name: 'Task notes' })).toBeInTheDocument();
    expect(renders.skeleton).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('leaves the notes once the open task is deleted', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWorkspace(`/tasks/${a.id}`);
    expect(await screen.findByLabelText('Title')).toHaveValue('Alpha');

    await user.click(
      within(screen.getByRole('region', { name: 'Task notes' })).getByRole('button', {
        name: 'Move “Alpha” to trash',
      }),
    );

    expect(await screen.findByText('Select a task to open its notes.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });
});
