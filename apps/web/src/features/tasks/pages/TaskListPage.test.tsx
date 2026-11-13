import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TaskListPageWithSearch } from '../test/listPage';

function mockApi(taskBody: unknown = fixtures.taskList) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(taskBody));
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    }),
  );
}

describe('TaskListPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders tasks, search, a New task action and sign out', async () => {
    const user = userEvent.setup();
    const onSignOut = vi.fn();
    mockApi();

    renderWithProviders(<TaskListPageWithSearch onSignOut={onSignOut} />, {
      route: '/tasks',
    });

    expect(
      await screen.findByRole('listitem', { name: 'Draft the quarterly report' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'New task' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New task' }).length).toBeGreaterThan(0);
    expect(screen.getByText('demo@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Account menu/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalled();
  });

  it('shows empty state', async () => {
    mockApi({ items: [] });
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
  });

  it('keeps the footer below the list, outside its scroller, even when the list is empty', async () => {
    mockApi({ items: [] });
    renderWithProviders(<TaskListPageWithSearch footer={<a href="/trash">Trash</a>} />, {
      route: '/tasks',
    });
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
    const footer = screen.getByRole('link', { name: 'Trash' });
    expect(footer.closest('.masterBody')).toBeNull();
    expect(footer.closest('[aria-label="Task list"]')).not.toBeNull();
  });

  it('shows the search results instead of the list, and no-results when there are none', async () => {
    mockApi();
    const results = {
      status: 'success' as const,
      tasks: [],
      error: null,
      retry: () => undefined,
      extras: () => undefined,
    };
    renderWithProviders(<TaskListPageWithSearch q="zzzz" results={results} />, {
      route: '/tasks?q=zzzz',
    });
    expect(await screen.findByText('No tasks match “zzzz”')).toBeInTheDocument();
    expect(screen.getByText('0 results · reorder paused')).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('shows retry on error', async () => {
    const user = userEvent.setup();
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        calls += 1;
        if (calls === 1) return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
        return Promise.resolve(jsonResponse(fixtures.taskList));
      }),
    );

    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(
        screen.getByRole('listitem', { name: 'Draft the quarterly report' }),
      ).toBeInTheDocument(),
    );
  });

  it('opens an inline draft at the top of the list and creates on Enter', async () => {
    const user = userEvent.setup();
    const created = {
      ...fixtures.task,
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Fresh',
    };
    let items: unknown[] = [...fixtures.taskList.items];
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      if (init?.method === 'POST') {
        items = [created, ...items];
        return Promise.resolve(jsonResponse(created, 201));
      }
      return Promise.resolve(jsonResponse({ items }));
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    await screen.findByRole('listitem', { name: 'Draft the quarterly report' });

    await user.click(screen.getAllByRole('button', { name: 'New task' })[0] as HTMLElement);
    const field = screen.getByRole('textbox', { name: 'New task' });
    expect(field).toHaveFocus();
    expect(await screen.findByRole('button', { name: /New task priority/ })).toHaveTextContent(
      'Medium',
    );
    const list = screen.getByRole('list', { name: 'Open tasks' });
    expect(field.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await user.type(field, 'Fresh{Enter}');

    expect(await screen.findByRole('listitem', { name: 'Fresh' })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'New task' })).not.toBeInTheDocument();
    });
    const rows = within(screen.getByRole('list', { name: 'Open tasks' })).getAllByRole('listitem');
    expect(rows[0]).toHaveAccessibleName('Fresh');
  });

  it('discards the draft on Escape and returns focus to New task', async () => {
    const user = userEvent.setup();
    mockApi();
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    await screen.findByRole('listitem', { name: 'Draft the quarterly report' });
    const opener = screen.getAllByRole('button', { name: 'New task' })[0] as HTMLElement;

    await user.click(opener);
    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Never mind{Escape}');

    expect(screen.queryByRole('textbox', { name: 'New task' })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('offers to create a task from the search text', async () => {
    const user = userEvent.setup();
    mockApi({ items: [] });
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    await screen.findByText('No tasks yet');

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Film scans');
    await user.click(await screen.findByRole('button', { name: /Create task “Film scans”/ }));

    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveValue('Film scans');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('');
  });

  it('splits the server list into open tasks and a Completed group without reordering', async () => {
    const [first, second] = fixtures.taskList.items;
    mockApi({
      items: [
        { ...second, id: '22222222-2222-4222-8222-222222222222', title: 'Done first' },
        { ...first, title: 'Open one' },
        { ...second, id: '33333333-3333-4333-8333-333333333333', title: 'Done second' },
      ],
    });
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });

    const open = await screen.findByRole('list', { name: 'Open tasks' });
    expect(within(open).getAllByRole('listitem')).toHaveLength(1);
    const completed = screen.getByRole('list', { name: 'Completed tasks', hidden: true });
    expect(
      within(completed)
        .getAllByRole('listitem', { hidden: true })
        .map((row) => row.ariaLabel),
    ).toEqual(['Done first', 'Done second']);
    expect(screen.getByText('1 open · 2 completed')).toBeInTheDocument();
  });

  it('shows the list as the master pane of a workspace with the notes beside it', async () => {
    mockApi();
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    await screen.findByRole('listitem', { name: 'Draft the quarterly report' });

    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'false');
    expect(screen.getByRole('region', { name: 'Task list' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Task notes' })).toHaveTextContent(
      'Select a task to open its notes.',
    );
  });
});
