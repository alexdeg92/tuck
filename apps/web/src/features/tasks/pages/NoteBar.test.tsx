import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TaskListPageWithSearch } from '../test/listPage';
import { TaskDetailPage } from './TaskDetailPage';

const task = fixtures.task;

function stubApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      if (url.startsWith(`/api/tasks/${task.id}`)) return Promise.resolve(jsonResponse(task));
      if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(fixtures.taskList));
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    }),
  );
}

function stubTier(phone: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: phone && query.includes('600px'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderAt(route: string, onSignOut = vi.fn()) {
  renderWithProviders(
    <Routes>
      <Route path="/tasks" element={<TaskListPageWithSearch onSignOut={onSignOut} />}>
        <Route path=":id" element={<TaskDetailPage />} />
      </Route>
    </Routes>,
    { route },
  );
  return onSignOut;
}

describe('the phone note bar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts Back, the save status, Task settings and the App menu in the one app bar', async () => {
    stubTier(true);
    stubApi();
    renderAt(`/tasks/${task.id}`);

    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();

    const bar = screen.getAllByRole('banner')[0] as HTMLElement;
    expect(within(bar).getByRole('link', { name: 'Back to tasks' })).toHaveAttribute(
      'href',
      '/tasks',
    );
    expect(within(bar).getByText('Saved')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Task settings' })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'App menu' })).toBeInTheDocument();
    // The brand and the Account menu make room; sign-out is in the App menu.
    expect(within(bar).queryByText('Tuck')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Account menu/ })).not.toBeInTheDocument();
    // The note has no head of its own, and there is one save status.
    const notes = screen.getByRole('region', { name: 'Task notes' });
    expect(notes.querySelector('header')).toBeNull();
    expect(within(notes).queryByRole('link', { name: /Tasks/ })).not.toBeInTheDocument();
    expect(within(notes).queryByRole('button', { name: 'Task settings' })).not.toBeInTheDocument();
    expect(document.querySelectorAll('.noteStatus')).toHaveLength(1);
  });

  it('opens the App menu with the account and Sign out; Escape closes it back to the button', async () => {
    const user = userEvent.setup();
    stubTier(true);
    stubApi();
    const onSignOut = renderAt(`/tasks/${task.id}`);
    await screen.findByLabelText('Notes');

    const trigger = screen.getByRole('button', { name: 'App menu' });
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'App menu' });
    expect(within(menu).getByText('demo@example.com')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Sign out' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it('offers Sign out everywhere in the App menu', async () => {
    const user = userEvent.setup();
    stubTier(true);
    stubApi();
    const onSignOutEverywhere = vi.fn();
    renderWithProviders(
      <Routes>
        <Route
          path="/tasks"
          element={
            <TaskListPageWithSearch onSignOut={vi.fn()} onSignOutEverywhere={onSignOutEverywhere} />
          }
        >
          <Route path=":id" element={<TaskDetailPage />} />
        </Route>
      </Routes>,
      { route: `/tasks/${task.id}` },
    );
    await screen.findByLabelText('Notes');

    await user.click(screen.getByRole('button', { name: 'App menu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Sign out everywhere' }));

    expect(onSignOutEverywhere).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps the normal bar on the phone list', async () => {
    stubTier(true);
    stubApi();
    renderAt('/tasks');

    const bar = await screen.findByRole('banner');
    expect(within(bar).getByText('Tuck')).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: /Account menu/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'App menu' })).not.toBeInTheDocument();
  });

  it('leaves desktop unchanged: the note keeps its own head, the bar keeps the Account menu', async () => {
    stubTier(false);
    stubApi();
    renderAt(`/tasks/${task.id}`);
    await screen.findByLabelText('Notes');

    const bar = screen.getAllByRole('banner')[0] as HTMLElement;
    expect(within(bar).getByRole('button', { name: /Account menu/ })).toBeInTheDocument();
    expect(within(bar).queryByRole('button', { name: 'App menu' })).not.toBeInTheDocument();
    const notes = screen.getByRole('region', { name: 'Task notes' });
    expect(within(notes).getByRole('button', { name: 'Task settings' })).toBeInTheDocument();
  });
});
