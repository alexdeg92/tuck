import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Task } from '@todo/contracts';
import { TaskList as TaskListSchema } from '@todo/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TaskListPageWithSearch } from '../test/listPage';

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(fixtures.taskList));
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    }),
  );
}

function stubPhoneTier() {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('600px'),
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

function stubServer({
  refuseDeletes = 0,
  onlyFirst = false,
}: { refuseDeletes?: number; onlyFirst?: boolean } = {}) {
  let tasks = TaskListSchema.parse(fixtures.taskList)
    .items.slice(0, onlyFirst ? 1 : undefined)
    .map((task) => ({ ...task }));
  const patches: string[] = [];
  let refusals = refuseDeletes;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
      if (init?.method === 'DELETE') {
        if (refusals > 0) {
          refusals -= 1;

          return new Promise((resolve) => {
            setTimeout(() => {
              resolve(jsonResponse(fixtures.errorValidation, 400));
            }, 50);
          });
        }
        const trashed = tasks.find((task) => url.endsWith(task.id));
        tasks = tasks.filter((task) => task !== trashed);
        const { deletedAt, purgeAt } = fixtures.trashedTask;
        return Promise.resolve(jsonResponse({ ...trashed, deletedAt, purgeAt }));
      }
      if (init?.method === 'PATCH') {
        const body = typeof init.body === 'string' ? init.body : '{}';
        patches.push(body);
        const task = tasks.find((candidate) => url.endsWith(candidate.id));
        if (task === undefined) return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
        Object.assign(task, JSON.parse(body) as Partial<Task>);
        return Promise.resolve(jsonResponse(task));
      }
      if (url.startsWith('/api/tasks')) {
        const ordered = [
          ...tasks.filter((task) => task.status !== 'done'),
          ...tasks.filter((task) => task.status === 'done'),
        ];
        return Promise.resolve(jsonResponse({ items: ordered }));
      }
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    }),
  );
  return patches;
}

describe('TaskListPage mobile chrome', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports a refused row delete with Retry, restores the task, and leaves no unhandled rejection', async () => {
    stubPhoneTier();
    stubServer({ refuseDeletes: 1 });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      const user = userEvent.setup();
      renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
        route: '/tasks',
      });
      const title = 'Draft the quarterly report';
      const row = await screen.findByRole('listitem', { name: title });
      await user.click(within(row).getByRole('button', { name: 'Task options' }));
      await user.click(await screen.findByRole('button', { name: 'Move to trash' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        `Could not move “${title}” to the trash.`,
      );
      expect(await screen.findByRole('listitem', { name: title })).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(screen.queryByRole('listitem', { name: title })).toBeNull();
      });
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });

  it('reports a refused delete of the only task even though the list gives way to the empty state', async () => {
    stubPhoneTier();
    stubServer({ refuseDeletes: 1, onlyFirst: true });
    const user = userEvent.setup();
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    const title = 'Draft the quarterly report';
    const row = await screen.findByRole('listitem', { name: title });
    await user.click(within(row).getByRole('button', { name: 'Task options' }));
    await user.click(await screen.findByRole('button', { name: 'Move to trash' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      `Could not move “${title}” to the trash.`,
    );
    expect(await screen.findByRole('listitem', { name: title })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps Undo after a swipe-complete regroups the task into Completed, and Undo reopens it', async () => {
    stubPhoneTier();
    const patches = stubServer();
    const user = userEvent.setup();
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });
    const title = 'Draft the quarterly report';
    const openList = await screen.findByRole('list', { name: 'Open tasks' });
    const surface = within(openList)
      .getByRole('listitem', { name: title })
      .querySelector('[data-done]') as HTMLElement;

    // A swipe to the left completes (a swipe to the right moves to the trash).
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 100, clientY: 40 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 100, clientY: 40 });

    const completed = await screen.findByRole('list', { name: 'Completed tasks' });
    await waitFor(() => {
      expect(within(completed).getByRole('listitem', { name: title })).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Open tasks' })).toBeNull();
    });
    expect(patches).toEqual(['{"status":"done"}']);

    await user.click(await screen.findByRole('button', { name: 'Undo' }));

    await waitFor(() => {
      expect(
        within(screen.getByRole('list', { name: 'Open tasks' })).getByRole('listitem', {
          name: title,
        }),
      ).toBeInTheDocument();
    });
    expect(patches).toEqual(['{"status":"done"}', '{"status":"todo"}']);
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('puts New task on the search row, with Tasks kept as a hidden heading', async () => {
    mockApi();
    renderWithProviders(<TaskListPageWithSearch onSignOut={() => undefined} />, {
      route: '/tasks',
    });

    await screen.findByRole('listitem', { name: 'Draft the quarterly report' });
    expect(document.querySelector('.mobileCapture')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Tasks' })).toHaveClass('srOnly');
    const create = screen.getByRole('button', { name: 'New task' });
    expect(create.parentElement).toContainElement(
      screen.getByRole('searchbox', { name: 'Search tasks' }),
    );
    expect(screen.getAllByRole('button', { name: 'New task' })).toHaveLength(1);
  });

  it('styles the phone New task as a 44px round icon-only button, at the field height elsewhere', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../components/TaskList.module.css'),
      'utf8',
    );
    const phone = css.slice(css.indexOf('@media (width < 600px)'));
    expect(phone).toMatch(/\.newTask \{[^}]*inline-size: 44px;[^}]*border-radius: 50%;/);
    expect(phone).toMatch(/\.newTaskLabel \{\s*display: none;/);
    expect(css).toMatch(/\.newTask \{[^}]*block-size: 36px;[^}]*border-radius: 6px;/);
    expect(css).toMatch(/@media \(pointer: coarse\) \{\s*\.newTask \{\s*block-size: 44px;/);
    const flow = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../styles/flow.css'),
      'utf8',
    );
    expect(flow).toMatch(/\.mobileCapture\s*\{\s*display:\s*none/);
    expect(flow).toMatch(
      /@media\s*\(\s*width\s*<\s*600px\s*\)[\s\S]*\.refinedList[\s\S]*border:\s*0/,
    );
  });

  it('keeps the phone full-bleed list rules after the list-card chrome', () => {
    const flow = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../styles/flow.css'),
      'utf8',
    );
    const listCard = flow.lastIndexOf('box-shadow: var(--p-list-cast);');
    const phoneBleed = flow.lastIndexOf(
      '/*\n * Phone layout. Must follow the list-card rules above so\n * phone full-bleed wins over the inset list chrome.\n */',
    );
    expect(listCard).toBeGreaterThan(-1);
    expect(phoneBleed).toBeGreaterThan(listCard);
    const phoneBlock = flow.slice(phoneBleed);
    expect(phoneBlock).toMatch(/\.refinedList[\s\S]*border:\s*0/);
    expect(phoneBlock).toMatch(/\.refinedList[\s\S]*border-radius:\s*0/);
  });

  it('gives the phone metadata its own cell under the title, apart from the options column', () => {
    const flow = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../styles/flow.css'),
      'utf8',
    );
    const phoneBlock = flow.slice(
      flow.lastIndexOf(' * Phone layout. Must follow the list-card rules'),
    );
    const rule = (selector: string) =>
      new RegExp(`\\n  ${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(phoneBlock)?.[1] ?? '';

    expect(phoneBlock).toMatch(/grid-template-columns: 24px 40px minmax\(0, 1fr\) 44px/);
    expect(rule('.rowMeta')).toMatch(/grid-column: 3;/);
    expect(rule('.rowMeta')).toMatch(/grid-row: 2;/);
    expect(rule('.rowMeta')).toMatch(/overflow: hidden;/);
    expect(rule('.rowDate')).toMatch(/text-overflow: ellipsis;/);
    expect(rule('.rowDate')).toMatch(/overflow: hidden;/);
  });
});
