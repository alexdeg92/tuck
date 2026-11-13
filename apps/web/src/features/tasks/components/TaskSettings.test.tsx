import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLocalTimeZone, today } from '@internationalized/date';
import { Task } from '@todo/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { bodyObject, didSend, sentBodies } from '../../../test/requests';
import { TaskSettings } from './TaskSettings';

const task = Task.parse(fixtures.task);

function stubApi(failPatch = false) {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
    if (init?.method === 'PATCH') {
      if (failPatch) return Promise.resolve(jsonResponse(fixtures.errorValidation, 400));
      return Promise.resolve(jsonResponse({ ...task, ...bodyObject(init) }));
    }
    return Promise.resolve(jsonResponse(task));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function openSheet() {
  fireEvent.click(screen.getByRole('button', { name: 'Task settings' }));
  await screen.findByRole('group', { name: 'Due date' });
  await screen.findByRole('button', { name: /Priority/ });
}

describe('TaskSettings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the task’s current priority, due date and completion', async () => {
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    expect(screen.getByRole('button', { name: /Priority/ })).toHaveTextContent('High');
    const due = within(screen.getByRole('group', { name: 'Due date' }));
    expect(due.getAllByRole('spinbutton').map((segment) => segment.textContent)).toEqual([
      '11',
      '20',
      '2026',
    ]);
    expect(screen.getByRole('checkbox', { name: 'Mark as done' })).not.toBeChecked();
  });

  it('shows the task title, Open notes, then Done / Priority / Due with Delete separated', async () => {
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />, { route: '/tasks' });
    await openSheet();

    const panel = screen.getByRole('dialog', { name: 'Task settings' });
    const title = panel.querySelector('.settingsTaskName');
    if (!(title instanceof HTMLElement)) throw new Error('expected settings task name');
    const openNotes = screen.getByRole('button', { name: 'Open notes' });
    const done = screen.getByRole('checkbox', { name: 'Mark as done' });
    const priority = screen.getByRole('button', { name: /Priority/ });
    const due = screen.getByRole('group', { name: 'Due date' });
    const del = screen.getByRole('button', { name: 'Move to trash' });
    expect(title).toHaveTextContent(task.title);
    expect(
      title.compareDocumentPosition(openNotes) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(openNotes.compareDocumentPosition(done) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(done.compareDocumentPosition(priority) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(priority.compareDocumentPosition(due) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.querySelector('.settingsFoot')?.contains(del)).toBe(true);
  });

  it('hides Open notes when this task’s notes are already open', () => {
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />, {
      route: `/tasks/${task.id}`,
    });

    expect(screen.queryByRole('button', { name: 'Open notes' })).not.toBeInTheDocument();
    expect(screen.getByText(task.title)).toBeInTheDocument();
  });

  it('applies a priority chosen in the custom listbox straight away', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Priority/ }));
    await user.click(await screen.findByRole('option', { name: 'Low' }));

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ priority: 'low' }]);
    });
    expect(await screen.findByText('Priority updated.')).toBeInTheDocument();
  });

  it('chooses a priority with the keyboard: Enter opens on the current value, arrows move, Enter picks', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    screen.getByRole('button', { name: /Priority/ }).focus();
    await user.keyboard('{Enter}');
    const current = await screen.findByRole('option', { name: 'High' });
    await waitFor(() => {
      expect(current).toHaveFocus();
    });
    await user.keyboard('{ArrowUp}{Enter}');

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ priority: 'medium' }]);
    });
  });

  it('sets the due date by picking a day in the custom calendar', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    const native = [...document.querySelectorAll('input[type="date"], select')];
    expect(native.every((element) => element.getAttribute('tabindex') === '-1')).toBe(true);

    await user.click(screen.getByRole('button', { name: /Choose due date/ }));
    const calendar = await screen.findByRole('grid');
    await user.click(within(calendar).getByRole('button', { name: /November 21, 2026/ }));

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ dueDate: '2026-11-21' }]);
    });
    expect(screen.queryByRole('grid')).toBeNull();
    expect(await screen.findByText('Due date updated.')).toBeInTheDocument();
  });

  it('clears the due date with Clear date', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Choose due date/ }));
    await user.click(await screen.findByRole('button', { name: 'Clear date' }));

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ dueDate: null }]);
    });
    expect(await screen.findByText('Due date cleared.')).toBeInTheDocument();
  });

  it('sets the due date to the local calendar day with Today', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={{ ...task, dueDate: null }} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Choose due date/ }));
    await user.click(await screen.findByRole('button', { name: 'Today' }));

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([
        { dueDate: today(getLocalTimeZone()).toString() },
      ]);
    });
  });

  it('saves a date typed segment by segment once, when it is complete', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={{ ...task, dueDate: null }} onDelete={vi.fn()} />);
    await openSheet();

    const [first] = within(screen.getByRole('group', { name: 'Due date' })).getAllByRole(
      'spinbutton',
    );
    if (first === undefined) throw new Error('no date segments');
    await user.click(first);
    await user.keyboard('01312030');

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ dueDate: '2030-01-31' }]);
    });
  });

  it('does not save when the calendar closes without a choice', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Choose due date/ }));
    await screen.findByRole('grid');
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('grid')).toBeNull();
    });
    expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);
  });

  it('shows the chosen priority and completion at once, before the server answers', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>(() => undefined)));
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Priority/ }));
    await user.click(await screen.findByRole('option', { name: 'Low' }));
    await user.click(screen.getByRole('checkbox', { name: 'Mark as done' }));

    expect(screen.getByRole('button', { name: /Priority/ })).toHaveTextContent('Low');
    expect(screen.getByRole('checkbox', { name: 'Mark as done' })).toBeChecked();
  });

  it('marks the task done', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);

    await user.click(screen.getByRole('checkbox', { name: 'Mark as done' }));

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ status: 'done' }]);
    });
  });

  it('says so when a change cannot be saved', async () => {
    const user = userEvent.setup();
    stubApi(true);
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    await openSheet();

    await user.click(screen.getByRole('button', { name: /Priority/ }));
    await user.click(await screen.findByRole('option', { name: 'Low' }));

    expect(await screen.findByText('Could not save that change.')).toBeInTheDocument();
  });

  it('asks its parent to move the task to the trash instead of deleting it itself', async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={onDelete} />);

    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(didSend(fetchMock, 'DELETE')).toBe(false);
  });

  it('tracks the popover open state on its trigger and closes with the close button', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />);
    const panel = screen.getByRole('dialog', { name: 'Task settings' });
    const hide = vi.fn();
    Object.assign(panel, { hidePopover: hide });

    const trigger = screen.getByRole('button', { name: 'Task settings' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    panel.dispatchEvent(
      Object.assign(new Event('toggle'), { newState: 'open', oldState: 'closed' }),
    );
    await waitFor(() => {
      expect(trigger).toHaveAttribute('aria-expanded', 'true');
    });
    await user.click(screen.getByRole('button', { name: 'Close task settings' }));
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the sheet on open and back to its trigger on Close', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />, { route: '/tasks' });
    const trigger = screen.getByRole('button', { name: 'Task settings' });

    trigger.focus();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Task settings' });
    await waitFor(() => {
      expect(panel.contains(document.activeElement)).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: 'Close task settings' }));
    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });

  it('leaves focus where the user put it when a click elsewhere light-dismisses the sheet', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(
      <>
        <TaskSettings task={task} onDelete={vi.fn()} />
        <textarea aria-label="Notes" />
      </>,
      { route: '/tasks' },
    );
    await user.click(screen.getByRole('button', { name: 'Task settings' }));
    const panel = await screen.findByRole('dialog', { name: 'Task settings' });

    const notes = screen.getByRole('textbox', { name: 'Notes' });
    notes.focus();
    panel.hidePopover();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Task settings' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
    expect(document.activeElement).toBe(notes);
  });

  it('frames the sheet: fixed head and foot, and only the body scrolls when space is short', () => {
    const flow = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../../../styles/flow.css'),
      'utf8',
    );
    const rule = (selector: string) =>
      [
        ...flow.matchAll(
          new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, '\\$&')} \\{([^}]*)\\}`, 'g'),
        ),
      ]
        .map((match) => match[1])
        .join('');

    expect(rule('.settingsPopover')).toMatch(/overflow: visible;/);
    expect(rule('.settingsPopover')).not.toMatch(/overflow: (auto|scroll|hidden);/);
    expect(rule('.settingsPopover:popover-open')).toMatch(
      /grid-template-rows: auto minmax\(0, 1fr\) auto;/,
    );
    expect(rule('.settingsBody')).toMatch(/min-block-size: 0;/);
    expect(rule('.settingsBody')).toMatch(/overflow: auto;/);
    expect(rule('.settingsBody')).toMatch(/overscroll-behavior: contain;/);
  });

  it('loads the priority and date controls on the first open, with field-shaped placeholders', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<TaskSettings task={task} onDelete={vi.fn()} />, { route: '/tasks' });
    const panel = screen.getByRole('dialog', { name: 'Task settings' });

    expect(within(panel).queryByText('Priority')).toBeNull();
    expect(within(panel).queryByText('Due date')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Task settings' }));

    expect(await within(panel).findByRole('button', { name: /Priority/ })).toHaveTextContent(
      'High',
    );
    expect(await within(panel).findByRole('group', { name: 'Due date' })).toBeInTheDocument();
  });

  async function typeDate(digits: string) {
    const [first] = within(screen.getByRole('group', { name: 'Due date' })).getAllByRole(
      'spinbutton',
    );
    if (first === undefined) throw new Error('no date segments');
    await userEvent.setup().click(first);
    await userEvent.setup().keyboard(digits);
  }

  it.each([
    ['01011900', '1900-01-01'],
    ['12319999', '9999-12-31'],
  ])('saves the contract edge date %s as %s', async (digits, saved) => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={{ ...task, dueDate: null }} onDelete={vi.fn()} />);
    await openSheet();

    await typeDate(digits);

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([{ dueDate: saved }]);
    });
  });

  it('refuses a date outside 1900–9999 without a request, and says why', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={{ ...task, dueDate: null }} onDelete={vi.fn()} />);
    await openSheet();

    await typeDate('01311899');

    expect(await screen.findByText('Use a date between 1900 and 9999.')).toBeInTheDocument();
    expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);
  });

  it('shows a saved date outside the range as it is, marked, without changing it', async () => {
    const fetchMock = stubApi();
    renderWithProviders(
      <TaskSettings task={{ ...task, dueDate: '1850-06-01' }} onDelete={vi.fn()} />,
    );
    await openSheet();

    const due = within(screen.getByRole('group', { name: 'Due date' }));
    expect(due.getAllByRole('spinbutton').map((segment) => segment.textContent)).toEqual([
      '6',
      '1',
      '1850',
    ]);
    expect(screen.getByText('Use a date between 1900 and 9999.')).toBeInTheDocument();
    expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);
  });

  it('never shows year 0000 as a different date', async () => {
    stubApi();
    renderWithProviders(
      <TaskSettings task={{ ...task, dueDate: '0000-01-01' }} onDelete={vi.fn()} />,
    );
    await openSheet();

    const due = within(screen.getByRole('group', { name: 'Due date' }));
    expect(due.queryByText(/^1$/)).toBeNull();
    expect(
      screen.getByText(
        'The saved date 0000-01-01 can’t be shown. Use a date between 1900 and 9999.',
      ),
    ).toBeInTheDocument();
  });

  it('says why when a typed year like 0999 is left out of range', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskSettings task={{ ...task, dueDate: null }} onDelete={vi.fn()} />);
    await openSheet();

    await typeDate('01310999');
    await userEvent.setup().tab();

    expect(await screen.findByText('Use a date between 1900 and 9999.')).toBeInTheDocument();
    expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);
  });

  it('says why when the saved date is 0999-01-01', async () => {
    stubApi();
    renderWithProviders(
      <TaskSettings task={{ ...task, dueDate: '0999-01-01' }} onDelete={vi.fn()} />,
    );
    await openSheet();

    expect(screen.getByText('Use a date between 1900 and 9999.')).toBeInTheDocument();
  });
});
