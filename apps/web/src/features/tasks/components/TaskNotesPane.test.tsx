import { Task } from '@todo/contracts';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse, trashedResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { bodyObject, didSend, sentBodies } from '../../../test/requests';
import { discardPendingSaves } from '../autosave';
import { draftSlot } from '../drafts';
import { TaskNotesPane } from './TaskNotesPane';

const task = Task.parse(fixtures.task);
const owner = '11111111-1111-4111-8111-111111111111';

function stubApi(overrides: Partial<Record<'PATCH' | 'DELETE', () => Response>> = {}) {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = requestUrl(input);
    const method = init?.method ?? 'GET';
    if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
    if (method === 'PATCH') {
      return Promise.resolve(overrides.PATCH?.() ?? jsonResponse({ ...task, ...bodyObject(init) }));
    }
    if (method === 'DELETE') return Promise.resolve(overrides.DELETE?.() ?? trashedResponse(task));
    return Promise.resolve(jsonResponse(task));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('TaskNotesPane', () => {
  afterEach(() => {
    discardPendingSaves();
    vi.unstubAllGlobals();
  });

  it('is a notes page: the title is the heading and the canvas holds the notes', () => {
    stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    const heading = screen.getByRole('heading', { level: 2, name: /Title/ });
    expect(within(heading).getByLabelText('Title')).toHaveValue(task.title);
    expect(screen.getByLabelText('Notes')).toHaveValue(task.notes);
    expect(screen.getByRole('link', { name: 'Tasks' })).toHaveAttribute('href', '/tasks');
  });

  it('keeps the canvas free of settings: they live in the Task settings panel', async () => {
    stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    const settings = screen.getByRole('dialog', { name: 'Task settings' });
    expect(settings).toHaveAttribute('popover');

    fireEvent.click(screen.getByRole('button', { name: 'Task settings' }));
    expect(await within(settings).findByRole('button', { name: /Priority/ })).toBeInTheDocument();
    expect(await within(settings).findByRole('group', { name: 'Due date' })).toBeInTheDocument();
    expect(within(settings).getByRole('checkbox', { name: 'Mark as done' })).toBeInTheDocument();
    expect(within(settings).getByRole('button', { name: 'Move to trash' })).toBeInTheDocument();
    const canvas = screen.getByLabelText('Notes').closest('form');
    expect(canvas).not.toBeNull();
    expect(within(canvas as HTMLElement).queryByLabelText('Priority')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Task settings' })).toHaveAttribute(
      'popovertarget',
      settings.id,
    );
  });

  it('has no Save button: it says Saved and saves title and notes 700 ms after typing stops', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      const fetchMock = stubApi();
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      await user.type(screen.getByLabelText('Notes'), ' More.');
      expect(screen.getByText('Editing…')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);

      await vi.advanceTimersByTimeAsync(700);
      await waitFor(() => {
        expect(sentBodies(fetchMock, 'PATCH')).toEqual([
          { notes: `${task.notes} More.`, expectedUpdatedAt: task.updatedAt },
        ]);
      });
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(screen.getByLabelText('Notes')).toHaveValue(`${task.notes} More.`);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not save in the middle of an IME composition, then saves the composed text', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const fetchMock = stubApi();
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);
      const notes = screen.getByLabelText('Notes');

      fireEvent.compositionStart(notes);
      fireEvent.change(notes, { target: { value: `${task.notes} caf´` } });
      await vi.advanceTimersByTimeAsync(2000);
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([]);
      expect(screen.getByText('Saved')).toBeInTheDocument();

      fireEvent.change(notes, { target: { value: `${task.notes} café` } });
      fireEvent.compositionEnd(notes);
      await vi.advanceTimersByTimeAsync(700);
      await waitFor(() => {
        expect(sentBodies(fetchMock, 'PATCH')).toEqual([
          { notes: `${task.notes} café`, expectedUpdatedAt: task.updatedAt },
        ]);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('never says Saved for unsent text: typing shows Editing… at once, and only a secondary note confirms the earlier save for 1.5 s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      stubApi();
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);
      await user.type(screen.getByLabelText('Notes'), '!');
      await user.tab();
      expect(await screen.findByText('Saved')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(1000);
      await user.type(screen.getByLabelText('Notes'), '?');
      expect(screen.getByText('Editing…')).toBeInTheDocument();
      expect(screen.queryByText('Saved')).not.toBeInTheDocument();
      expect(document.querySelector('[data-state]')).toHaveAttribute('data-state', 'editing');
      expect(screen.getByText('Earlier changes saved')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(600);
      await waitFor(() => {
        expect(screen.queryByText('Earlier changes saved')).not.toBeInTheDocument();
      });
      expect(screen.getByText('Editing…')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('saves at once when the field loses focus, and Enter in the title does the same', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.type(screen.getByLabelText('Title'), '!{Enter}');

    expect(screen.getByLabelText('Title')).not.toHaveFocus();
    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([
        { title: `${task.title}!`, expectedUpdatedAt: task.updatedAt },
      ]);
    });
  });

  it('flags a blank title inline and never sends it, while notes still save', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Notes'), '!');
    await user.click(screen.getByLabelText('Title'));

    const title = screen.getByLabelText('Title');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveAccessibleDescription('A task needs a title.');

    expect(screen.getByText('Not saved')).toBeInTheDocument();
    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([
        { notes: `${task.notes}!`, expectedUpdatedAt: task.updatedAt },
      ]);
    });
  });

  it("says it couldn't save, offers Retry, and Retry sends again", async () => {
    const user = userEvent.setup();
    let failing = true;
    const fetchMock = stubApi({
      PATCH: () =>
        failing
          ? jsonResponse({ error: { code: 'INTERNAL', message: 'down' } }, 500)
          : jsonResponse({ ...task, notes: `${task.notes}!` }),
    });
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.type(screen.getByLabelText('Notes'), '!');
    await user.tab();

    expect(await screen.findByText('Couldn’t save')).toBeInTheDocument();
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(sentBodies(fetchMock, 'PATCH')).toHaveLength(2);
  });

  it('on a conflict asks Keep mine or Use theirs; Use theirs shows their notes', async () => {
    const user = userEvent.setup();
    const theirs = {
      ...task,
      notes: 'Edited in another tab.',
      updatedAt: '2026-11-11T10:05:00.000Z',
    };
    const fetchMock = stubApi({
      PATCH: () =>
        jsonResponse(
          {
            error: {
              code: 'CONFLICT',
              message: 'This task changed since you loaded it',
              current: theirs,
            },
          },
          409,
        ),
    });
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.type(screen.getByLabelText('Notes'), ' mine');
    await user.tab();

    const choice = await screen.findByRole('alert');
    expect(choice).toHaveTextContent('This note changed elsewhere.');
    await user.click(within(choice).getByRole('button', { name: 'Use theirs' }));

    expect(screen.getByLabelText('Notes')).toHaveValue('Edited in another tab.');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Saved')).toBeInTheDocument();
    expect(sentBodies(fetchMock, 'PATCH')).toHaveLength(1);
  });

  it('Keep mine saves my notes over theirs', async () => {
    const user = userEvent.setup();
    const theirs = {
      ...task,
      notes: 'Edited in another tab.',
      updatedAt: '2026-11-11T10:05:00.000Z',
    };
    let first = true;
    const fetchMock = stubApi({
      PATCH: () => {
        if (!first) return jsonResponse({ ...theirs, notes: `${task.notes} mine` });
        first = false;
        return jsonResponse(
          {
            error: {
              code: 'CONFLICT',
              message: 'This task changed since you loaded it',
              current: theirs,
            },
          },
          409,
        );
      },
    });
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.type(screen.getByLabelText('Notes'), ' mine');
    await user.tab();
    await user.click(
      within(await screen.findByRole('alert')).getByRole('button', { name: 'Keep mine' }),
    );

    await waitFor(() => {
      expect(sentBodies(fetchMock, 'PATCH')).toEqual([
        { notes: `${task.notes} mine`, expectedUpdatedAt: task.updatedAt },
        { notes: `${task.notes} mine`, expectedUpdatedAt: theirs.updatedAt },
      ]);
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toHaveValue(`${task.notes} mine`);
  });

  it('offline: Not saved in the head, and the body says the changes are kept on this device', async () => {
    const user = userEvent.setup();
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fetchMock = stubApi();
    fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(jsonResponse(input === '/api/health' ? fixtures.health : task)),
    );
    try {
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" ownerId={owner} />);
      await user.type(screen.getByLabelText('Notes'), '!');
      await user.tab();

      expect(await screen.findByText('Not saved')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Offline. Your changes are kept on this device and will save when you’re back.',
        ),
      ).toBeInTheDocument();
    } finally {
      online.mockRestore();
      localStorage.clear();
    }
  });

  it('restores a stored draft after a reload, says so, and saves it', async () => {
    const fetchMock = stubApi();
    draftSlot(owner, task.id).write({
      title: task.title,
      notes: 'Typed before the reload.',
      base: { title: task.title, notes: task.notes, updatedAt: task.updatedAt },
      rev: 1,
    });
    try {
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" ownerId={owner} />);

      expect(screen.getByLabelText('Notes')).toHaveValue('Typed before the reload.');
      expect(screen.getByText('Restored unsaved changes')).toBeInTheDocument();
      await waitFor(() => {
        expect(sentBodies(fetchMock, 'PATCH')).toEqual([
          { notes: 'Typed before the reload.', expectedUpdatedAt: task.updatedAt },
        ]);
      });
      expect(await screen.findByText('Saved')).toBeInTheDocument();
      expect(draftSlot(owner, task.id).read()).toBeUndefined();
    } finally {
      localStorage.clear();
    }
  });

  it('says honestly when the device cannot keep unsaved changes', async () => {
    const user = userEvent.setup();
    stubApi();
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    try {
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" ownerId={owner} />);
      await user.type(screen.getByLabelText('Notes'), '!');

      expect(
        screen.getByText('Changes are only kept in this tab. Device recovery isn’t available.'),
      ).toBeInTheDocument();
    } finally {
      setItem.mockRestore();
    }
  });

  it('never tells a screen reader "saved" while the title is invalid', async () => {
    const user = userEvent.setup();
    stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

    await user.clear(screen.getByLabelText('Title'));
    await user.click(screen.getByLabelText('Notes'));

    const live = document.querySelector('[aria-live="polite"]');
    await waitFor(() => {
      expect(live).toHaveTextContent('Not saved. A task needs a title.');
    });
    expect(live).not.toHaveTextContent('All changes saved');
  });

  it('Retry turns into a busy Saving… at once and cannot be pressed twice', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    let attempt = 0;
    const fetchMock = stubApi({
      PATCH: () => {
        attempt += 1;
        return jsonResponse({ error: { code: 'INTERNAL', message: 'down' } }, 500);
      },
    });
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);
    await user.type(screen.getByLabelText('Notes'), '!');
    await user.tab();
    const retry = await screen.findByRole('button', { name: 'Retry' });

    const answer = fetchMock.getMockImplementation();
    fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) =>
      init?.method === 'PATCH'
        ? new Promise<Response>((resolve) => {
            attempt += 1;
            release = (response) => {
              resolve(response);
            };
          })
        : ((answer?.(input, init) as Promise<Response> | undefined) ??
          Promise.resolve(jsonResponse(task))),
    );
    await user.click(retry);

    expect(screen.getByText('Saving…')).toBeInTheDocument();
    expect(screen.queryByText('Couldn’t save')).not.toBeInTheDocument();
    const busy = screen.getByRole('button', { name: /Retry|Retrying/ });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await user.click(busy);
    expect(attempt).toBe(2);

    release(jsonResponse({ ...task, notes: `${task.notes}!` }));
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('a real pointer press on Retry while Notes has focus still shows the busy Saving…', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });
      let held = false;
      const fetchMock = stubApi({
        PATCH: () => jsonResponse({ error: { code: 'INTERNAL', message: 'down' } }, 500),
      });
      const answer = fetchMock.getMockImplementation();
      fetchMock.mockImplementation((input: RequestInfo, init?: RequestInit) =>
        held && init?.method === 'PATCH'
          ? new Promise<Response>(() => undefined)
          : ((answer?.(input, init) as Promise<Response> | undefined) ??
            Promise.resolve(jsonResponse(task))),
      );
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);

      await user.type(screen.getByLabelText('Notes'), '!');
      await vi.advanceTimersByTimeAsync(700);
      const retry = await screen.findByRole('button', { name: 'Retry' });
      expect(screen.getByLabelText('Notes')).toHaveFocus();

      held = true;

      await user.click(retry);

      expect(screen.getByText('Saving…')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Retry|Retrying/ })).toHaveAttribute(
        'aria-busy',
        'true',
      );
      expect(document.querySelector('[data-state]')).toHaveAttribute('data-state', 'retrying');
      expect(sentBodies(fetchMock, 'PATCH')).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(['Keep mine', 'Use theirs'])(
    'after %s by keyboard, focus returns to the notes, and the choice leaves inert',
    async (choice) => {
      const user = userEvent.setup();
      const theirs = {
        ...task,
        notes: 'Edited in another tab.',
        updatedAt: '2026-11-11T10:05:00.000Z',
      };
      let first = true;
      stubApi({
        PATCH: () => {
          if (!first) return jsonResponse({ ...theirs, notes: `${task.notes} mine` });
          first = false;
          return jsonResponse(
            { error: { code: 'CONFLICT', message: 'changed', current: theirs } },
            409,
          );
        },
      });
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />);
      await user.type(screen.getByLabelText('Notes'), ' mine');
      await user.tab();

      const button = within(await screen.findByRole('alert')).getByRole('button', { name: choice });
      button.focus();
      await user.keyboard('{Enter}');

      expect(screen.getByLabelText('Notes')).toHaveFocus();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      const leaving = document.querySelector('[data-phase="leaving"]');
      expect(leaving).toHaveAttribute('inert');
      await waitFor(() => {
        expect(document.querySelector('[data-phase="leaving"]')).toBeNull();
      });
    },
  );

  it.each([
    ['Task settings', 'Move to trash'],
    ['the notes head', `Move “${task.title}” to trash`],
  ])('moves the task to the trash at once from %s', async (_where, name) => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    renderWithProviders(<TaskNotesPane task={task} backTo="/tasks?q=report" />, {
      route: `/tasks/${task.id}`,
    });

    await user.click(screen.getByRole('button', { name }));

    await waitFor(() => {
      expect(didSend(fetchMock, 'DELETE')).toBe(true);
    });
    expect(screen.queryByRole('dialog', { name: 'Delete task?' })).not.toBeInTheDocument();
  });

  it('says so, with Retry, when the move to the trash is refused', async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi({ DELETE: () => jsonResponse(fixtures.errorValidation, 400) });
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', onRejection);
    try {
      renderWithProviders(<TaskNotesPane task={task} backTo="/tasks" />, {
        route: `/tasks/${task.id}`,
      });
      await user.click(screen.getByRole('button', { name: `Move “${task.title}” to trash` }));

      const alert = await screen.findByText('Could not move this task to the trash.', {
        exact: false,
      });
      expect(alert.closest('[role="alert"]')).not.toBeNull();
      await user.click(screen.getByRole('button', { name: 'Retry' }));
      await waitFor(() => {
        expect(
          fetchMock.mock.calls.filter(
            ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
          ),
        ).toHaveLength(2);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', onRejection);
    }
  });
});
