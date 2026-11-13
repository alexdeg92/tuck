import { Task, TaskList as TaskListSchema } from '@todo/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Route, Routes } from 'react-router';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { TaskList } from './TaskList';

const idleDeletion = { send: vi.fn(), pending: false };

const base = Task.parse(fixtures.task);
const make = (n: number, status: 'todo' | 'done'): Task => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Task ${String(n)}`,
  status,
});

describe('TaskList', () => {
  const tasks = TaskListSchema.parse(fixtures.taskList).items;
  const open = tasks.find((task) => task.status === 'todo');
  const openTitle = open?.title ?? '';

  it('renders listitems named by title and reorder handles', () => {
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={tasks} q="" />);

    expect(screen.getByRole('list', { name: 'Open tasks' })).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: openTitle })).toBeInTheDocument();
    const handle = screen.getByRole('button', { name: `Reorder ${openTitle}` });
    expect(handle).toBeEnabled();
    expect(handle).toHaveAttribute('aria-roledescription');
    expect(handle.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('disables reorder handles while searching', () => {
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={tasks} q="report" />);

    expect(screen.getByRole('button', { name: `Reorder ${openTitle}` })).toBeDisabled();
  });

  it('stacks a search hit: its row carries the search layout and the extras inside the title link', () => {
    const hit = tasks[0];
    if (hit === undefined) throw new Error('fixture');
    renderWithProviders(
      <TaskList
        deletion={idleDeletion}
        tasks={[hit]}
        q="report"
        extras={() => ({ title: 'Marked title', details: 'Matches in notes', meta: null })}
      />,
    );
    const link = screen.getByRole('link', { name: /Marked title/ });
    expect(link).toHaveTextContent('Marked titleMatches in notes');
    expect(link.closest('[data-done]')).toHaveAttribute('data-search', 'true');

    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /:global\(\.taskRow\)\[data-search='true'\] \.link \{[^}]*flex-direction: column;/,
    );
  });

  it('sets touch-action none on the reorder handle and pan-y on phone gesture rows', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css');
    const css = readFileSync(cssPath, 'utf8');
    expect(css).toMatch(/\.grip\s*\{[^}]*touch-action:\s*none/s);
    expect(css).toMatch(/\.touchRow\s*\{[^}]*touch-action:\s*pan-y pinch-zoom/s);
  });

  it('lists open tasks first, then a collapsed Completed group, in the server order', async () => {
    const user = userEvent.setup();
    const items = [make(3, 'done'), make(2, 'todo'), make(5, 'done'), make(1, 'todo')];
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={items} q="" />);

    const openList = screen.getByRole('list', { name: 'Open tasks' });
    expect(
      within(openList)
        .getAllByRole('listitem')
        .map((row) => row.ariaLabel),
    ).toEqual(['Task 2', 'Task 1']);

    const summary = screen.getByText('Completed', { selector: 'summary span' }).closest('summary');
    expect(summary).not.toBeNull();
    expect(summary).toHaveTextContent('2');
    const group = summary?.closest('details');
    expect(group).not.toHaveAttribute('open');
    await user.click(summary as HTMLElement);
    expect(group).toHaveAttribute('open');

    const doneList = screen.getByRole('list', { name: 'Completed tasks', hidden: true });
    expect(
      within(doneList)
        .getAllByRole('listitem', { hidden: true })
        .map((row) => row.ariaLabel),
    ).toEqual(['Task 3', 'Task 5']);

    await user.click(summary as HTMLElement);
    expect(group).not.toHaveAttribute('open');
  });

  it('keeps reordering to open tasks: completed rows have a disabled handle', () => {
    renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[make(1, 'todo'), make(2, 'done')]} q="" />,
    );

    expect(screen.getByRole('button', { name: 'Reorder Task 1' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reorder Task 2', hidden: true })).toBeDisabled();
  });

  it('omits the groups that are empty, once a leaving row has gone', async () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[make(1, 'todo')]} q="" />,
    );
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
    rerender(<TaskList deletion={idleDeletion} tasks={[make(2, 'done')]} q="" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('list', { name: 'Open tasks' })).not.toBeInTheDocument();
    });
  });

  it('keeps a completed row in place, checked, inert and hidden, until its exit ends', () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[make(1, 'todo'), make(2, 'todo')]} q="" />,
    );
    rerender(<TaskList deletion={idleDeletion} tasks={[make(2, 'todo'), make(1, 'done')]} q="" />);
    const openList = screen.getByRole('list', { name: 'Open tasks' });
    const ghost = openList.querySelector('li[data-phase="completing"]');
    expect(ghost).not.toBeNull();
    expect(ghost).toHaveAttribute('inert');
    expect(ghost).toHaveAttribute('aria-hidden', 'true');
    expect(ghost?.querySelector('input')).toBeChecked();
    expect(ghost).toHaveTextContent('Completed');

    expect(
      within(openList)
        .getAllByRole('listitem')
        .map((row) => row.getAttribute('aria-label')),
    ).toEqual(['Task 2']);
    expect(openList.firstElementChild).toBe(ghost);
    expect(
      screen.getByText('Completed', { selector: 'summary span' }).closest('summary'),
    ).toHaveAttribute('data-received', 'true');
  });

  it('marks a deleted row as leaving and shows the empty state only after it has gone', async () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[make(1, 'todo')]} q="" empty={<p>Nothing</p>} />,
    );
    rerender(<TaskList deletion={idleDeletion} tasks={[]} q="" empty={<p>Nothing</p>} />);
    const ghost = document.querySelector('li[data-phase="leaving"]');
    expect(ghost).toHaveAttribute('data-exit', 'delete');
    expect(screen.queryByText('Nothing')).not.toBeInTheDocument();
    expect(await screen.findByText('Nothing')).toBeInTheDocument();
    expect(document.querySelector('li[data-phase]')).toBeNull();
  });

  it('marks a task created in the same list, and not a first render or a new search', () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[make(1, 'todo')]} q="" />,
    );
    expect(document.querySelector('li[data-phase]')).toBeNull();
    rerender(<TaskList deletion={idleDeletion} tasks={[make(2, 'todo'), make(1, 'todo')]} q="" />);
    expect(screen.getByRole('listitem', { name: 'Task 2' })).toHaveAttribute(
      'data-phase',
      'created',
    );
    rerender(<TaskList deletion={idleDeletion} tasks={[make(3, 'todo')]} q="three" />);
    expect(document.querySelector('li[data-phase]')).toBeNull();
  });

  it('marks the open task with aria-current and keeps the search in the link', () => {
    const items = [make(1, 'todo'), make(2, 'todo')];
    renderWithProviders(
      <Routes>
        <Route
          path="/tasks/:id"
          element={<TaskList deletion={idleDeletion} tasks={items} q="task" />}
        />
      </Routes>,
      { route: `/tasks/${items[0]?.id ?? ''}` },
    );

    const current = screen.getByRole('link', { name: 'Task 1' });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Task 2' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Task 2' })).toHaveAttribute(
      'href',
      `/tasks/${items[1]?.id ?? ''}?q=task`,
    );
  });
});
