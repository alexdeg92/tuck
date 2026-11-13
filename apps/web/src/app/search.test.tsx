import {
  UpdateTaskInput,
  type ChecklistItem,
  type Highlight,
  type SearchResult,
  type Task,
  type TaskHighlights,
} from '@todo/contracts';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../test/fixtures';
import { bodyObject } from '../test/requests';
import { requestUrl } from '../test/url';
import { Providers } from './providers';
import { AppRoutes } from './router';

const AT = '2026-11-12T10:00:00.000Z';
const LATER = '2026-11-12T11:00:00.000Z';
const ID = '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c';
const ITEM = '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const OTHER = '7b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e';

const task: Task = {
  id: ID,
  title: 'Budget review',
  notes: 'My budget is tight. Check the budget twice.',
  status: 'todo',
  priority: 'medium',
  dueDate: null,
  position: 'a0',
  createdAt: AT,
  updatedAt: AT,
  completedAt: null,
  checklist: { done: 0, total: 1 },
};
const item: ChecklistItem = {
  id: ITEM,
  taskId: ID,
  text: 'Budget sheet',
  notes: '',
  done: false,
  position: 'a0',
  createdAt: AT,
  updatedAt: AT,
};
const TITLE: Highlight[] = [[0, 6]];
const NOTES: Highlight[] = [
  [3, 9],
  [30, 36],
];

const map = (overrides: Partial<TaskHighlights> = {}): TaskHighlights => ({
  taskUpdatedAt: AT,
  query: 'budget',
  mode: 'exact',
  fields: {
    title: TITLE,
    notes: NOTES,
    items: [{ itemId: ITEM, updatedAt: AT, text: [[0, 6]], notes: [] }],
  },
  truncated: false,
  ...overrides,
});

const results = (overrides: Partial<SearchResult> = {}): SearchResult => ({
  query: 'budget',
  mode: 'exact',
  suggestion: null,
  hits: [
    {
      task,
      score: 3,
      matchCount: { value: 4, exact: true },
      sourceCounts: { notes: { value: 2, exact: true }, checklist: { value: 1, exact: true } },
      matches: [
        {
          field: 'title',
          itemId: null,
          snippet: task.title,
          sourceStart: 0,
          sourceEnd: 13,
          highlights: TITLE,
        },
        {
          field: 'notes',
          itemId: null,
          snippet: 'budget is tight.',
          sourceStart: 3,
          sourceEnd: 19,
          highlights: [[0, 6]],
        },
      ],
    },
  ],
  truncated: false,
  ...overrides,
});

type Server = {
  saved?: { task: Task };
  search?: () => Response;
  highlights?: () => Response;
  checklist?: () => Response;
};

function serve(server: Server = {}) {
  const saved = server.saved ?? { task };
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input);
    if (init?.method === 'PATCH') {
      const input = UpdateTaskInput.parse(bodyObject(init));

      saved.task = {
        ...saved.task,
        title: input.title ?? saved.task.title,
        notes: input.notes ?? saved.task.notes,
        updatedAt: LATER,
      };
      return Promise.resolve(jsonResponse(saved.task));
    }
    if (url.startsWith('/api/auth/me')) return Promise.resolve(jsonResponse(fixtures.user));
    if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
    if (url.startsWith('/api/search'))
      return Promise.resolve(server.search?.() ?? jsonResponse(results()));
    if (url.includes('/highlights'))
      return Promise.resolve(
        server.highlights?.() ?? jsonResponse(map({ taskUpdatedAt: saved.task.updatedAt })),
      );
    if (url.includes('/checklist'))
      return Promise.resolve(server.checklist?.() ?? jsonResponse({ items: [item] }));
    if (url === `/api/tasks/${ID}`) return Promise.resolve(jsonResponse(saved.task));
    if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse({ items: [task] }));
    return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const calls = (fetchMock: ReturnType<typeof serve>, part: string) =>
  fetchMock.mock.calls.map(([input]) => requestUrl(input)).filter((url) => url.includes(part));

function renderAt(route: string) {
  return render(
    <Providers>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
      </MemoryRouter>
    </Providers>,
  );
}

const finder = () => screen.getByRole('group', { name: 'Search matches' });
const findFinder = () => screen.findByRole('group', { name: 'Search matches' });

const expectStatus = async (text: string) => {
  await findFinder();
  await waitFor(() => {
    expect(within(finder()).getByRole('status')).toHaveTextContent(text);
  });
};
const reading = () => screen.getByRole('region', { name: 'Task with search matches' });
const currentMark = () => reading().querySelector('mark[aria-current="true"]');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('search results in the list', () => {
  it('lists /api/search hits with the title marked and where it matched, never a note excerpt', async () => {
    const fetchMock = serve();
    renderAt('/tasks?q=budget');

    const row = await screen.findByRole('listitem', { name: 'Budget review' });
    expect(within(row).getByText('Budget', { selector: 'mark' })).toBeInTheDocument();

    const link = within(row).getAllByRole('link')[0];
    expect(link).toHaveTextContent(/^Budget review2 matches in notes · 1 match in checklist$/);
    expect(within(row).queryByText(/is tight/)).not.toBeInTheDocument();
    expect(within(row).queryByText(/^\d+\+? matches$/)).not.toBeInTheDocument();
    expect(screen.getByText('1 result · reorder paused')).toBeInTheDocument();
    expect(calls(fetchMock, '/api/search')).toEqual(['/api/search?q=budget']);
    expect(calls(fetchMock, '/api/tasks?q=budget')).toEqual([]);
  });

  it('keeps the server ranking: a completed best hit stays first and in view, with its status', async () => {
    const [hit] = results().hits;
    if (hit === undefined) throw new Error('fixture');
    serve({
      search: () =>
        jsonResponse(
          results({
            hits: [
              {
                ...hit,
                task: {
                  ...task,
                  id: OTHER,
                  title: 'Best completed hit',
                  status: 'done',
                  completedAt: AT,
                },
              },
              { ...hit, task: { ...task, title: 'Lower open hit' } },
            ],
          }),
        ),
    });
    renderAt('/tasks?q=budget');

    await screen.findByRole('listitem', { name: 'Best completed hit' });
    expect(screen.getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Best completed hit',
      'Lower open hit',
    ]);
    expect(screen.getByRole('listitem', { name: 'Best completed hit' })).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Mark Best completed hit as done' })).toBeChecked();
    expect(screen.queryByText('Completed')).not.toBeInTheDocument();
  });

  it('offers the server suggestion as "Did you mean" and applies it', async () => {
    const user = userEvent.setup();
    serve({
      search: () =>
        jsonResponse(
          results({
            query: 'budgte',
            mode: 'fuzzy',
            suggestion: { text: 'budget', changed: [{ start: 0, end: 6, typed: 'budgte' }] },
          }),
        ),
    });
    renderAt('/tasks?q=budgte');

    expect(await screen.findByText('Showing close matches')).toBeInTheDocument();
    const suggestion = screen.getByRole('button', { name: 'budget' });
    expect(suggestion.querySelector('[data-changed]')).toHaveTextContent(/^budget$/);
    await user.click(suggestion);
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('budget');
  });

  it('keeps Create task from the search text', async () => {
    const user = userEvent.setup();
    serve();
    renderAt('/tasks');
    await screen.findByRole('listitem', { name: 'Budget review' });

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'Film scans');
    await user.click(await screen.findByRole('button', { name: /Create task “Film scans”/ }));
    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveValue('Film scans');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('');
  });
});

describe('the open task while searching', () => {
  it('marks every match, title to checklist, and steps through them in document order', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);

    expect(await within(await findFinder()).findByText('1 of 4')).toBeInTheDocument();
    expect(within(finder()).getByRole('status')).toHaveTextContent('Match 1 of 4, Title.');
    expect(reading().querySelectorAll('mark')).toHaveLength(4);
    expect(currentMark()).toHaveTextContent('Budget');
    expect(reading().querySelector('li mark')).toHaveTextContent('Budget');

    await user.click(within(finder()).getByRole('button', { name: 'Next match' }));
    expect(within(finder()).getByText('2 of 4')).toBeInTheDocument();
    expect(within(finder()).getByRole('status')).toHaveTextContent('Match 2 of 4, Notes.');
    expect(within(finder()).getByRole('button', { name: 'Next match' })).toHaveFocus();

    await user.click(within(finder()).getByRole('button', { name: 'Previous match' }));
    await user.click(within(finder()).getByRole('button', { name: 'Previous match' }));
    expect(within(finder()).getByRole('status')).toHaveTextContent(
      'Wrapped to last match. Match 4 of 4, Checklist item.',
    );
    expect(currentMark()?.closest('li')).not.toBeNull();
  });

  it('steps with Enter and Shift+Enter on the read view, never inside its buttons', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    reading().focus();
    await user.keyboard('{Enter}');
    expect(within(finder()).getByText('2 of 4')).toBeInTheDocument();
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(within(finder()).getByText('1 of 4')).toBeInTheDocument();
    await user.keyboard('{F3}');
    expect(within(finder()).getByText('2 of 4')).toBeInTheDocument();
  });

  it('pauses on Edit note, autosaves the draft, and shows the saved text marked again', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    await expectStatus('Highlighting paused while editing');
    const editor = screen.getByRole('textbox', { name: 'Notes' });
    await waitFor(() => {
      expect(editor).toHaveFocus();
    });
    await user.type(editor, ' More.');

    await user.click(within(finder()).getByRole('button', { name: 'Show matches' }));
    expect(await within(reading()).findByText(/twice\. More\./)).toBeInTheDocument();
    expect(await within(finder()).findByText('1 of 4')).toBeInTheDocument();
  });

  it('marks the autosaved revision with its own map once the reader shows matches again', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), ' Done.');
    await user.click(within(finder()).getByRole('button', { name: 'Show matches' }));

    expect(await within(reading()).findByText(/twice\. Done\./)).toBeInTheDocument();
    expect(await within(finder()).findByText('1 of 4')).toBeInTheDocument();

    expect(calls(fetchMock, '/highlights').length).toBeGreaterThanOrEqual(2);
  });

  it('opens with focus in the read view, never on the page body', async () => {
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');
    expect(reading()).toHaveFocus();
  });

  it('returns focus to the read view after Show matches', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    await user.click(within(finder()).getByRole('button', { name: 'Show matches' }));
    await waitFor(() => {
      expect(reading()).toHaveFocus();
    });
  });

  it('puts the editor caret on the current match when the search is cleared', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');
    await user.click(within(finder()).getByRole('button', { name: 'Next match' }));

    await user.click(within(finder()).getByRole('button', { name: 'Clear search' }));
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await waitFor(() => {
      expect(notes).toHaveFocus();
    });
    expect(notes).toHaveProperty('selectionStart', NOTES[0]?.[0]);
  });

  it('keeps the editor caret when the search is cleared while editing', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');
    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    const notes = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Notes' });
    await waitFor(() => {
      expect(notes).toHaveFocus();
    });
    notes.setSelectionRange(12, 12);

    await user.click(within(finder()).getByRole('button', { name: 'Clear search' }));
    await waitFor(() => {
      expect(notes).toHaveFocus();
    });
    expect(notes.selectionStart).toBe(12);
  });

  it('fades the cleared finder out as an inert copy, then removes it', async () => {
    const user = userEvent.setup();
    serve();
    const { container } = renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(within(finder()).getByRole('button', { name: 'Clear search' }));
    const outgoing = container.querySelector('[data-exiting]');
    expect(outgoing).toHaveAttribute('aria-hidden', 'true');
    expect(outgoing).toHaveAttribute('inert');
    if (outgoing === null) throw new Error('no outgoing finder');
    fireEvent.animationEnd(outgoing);
    expect(container.querySelector('[data-exiting]')).toBeNull();
  });

  it('clears the search from the finder and keeps the task open in its editor', async () => {
    const user = userEvent.setup();
    serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(within(finder()).getByRole('button', { name: 'Clear search' }));
    expect(screen.queryByRole('group', { name: 'Search matches' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue(task.notes);
    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('');
    });
  });

  it('drops a changed item and pauses the exact counter until a fresh map arrives', async () => {
    let checklistReads = 0;
    const fetchMock = serve({
      checklist: () => {
        checklistReads += 1;
        return jsonResponse({ items: [{ ...item, updatedAt: LATER }] });
      },
    });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('Updating matches…');
    expect(reading().querySelectorAll('mark')).toHaveLength(3);
    expect(within(finder()).getByRole('button', { name: 'Next match' })).toBeDisabled();
    await waitFor(() => {
      expect(calls(fetchMock, '/highlights')).toHaveLength(2);
    });
    expect(checklistReads).toBe(2);
  });

  it('shows no marks from a map of another task revision', async () => {
    serve({ highlights: () => jsonResponse(map({ taskUpdatedAt: LATER })) });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('Updating matches…');
    expect(reading().querySelectorAll('mark')).toHaveLength(0);
  });

  it('labels a capped map as a lower bound and says some matches are not shown', async () => {
    serve({ highlights: () => jsonResponse(map({ truncated: true })) });
    renderAt(`/tasks/${ID}?q=budget`);

    expect(await within(await findFinder()).findByText('1 of 4+')).toBeInTheDocument();
    expect(screen.getByText('Some matches aren’t shown. Refine your search.')).toBeInTheDocument();
  });

  it('says there are no matches in this task, with the arrows disabled', async () => {
    serve({
      highlights: () =>
        jsonResponse(map({ mode: 'none', fields: { title: [], notes: [], items: [] } })),
    });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('No matches in this task');
    expect(within(finder()).getByRole('button', { name: 'Previous match' })).toBeDisabled();
    expect(within(reading()).getByText(task.notes)).toBeInTheDocument();
  });

  it('offers Retry when the checklist the map needs fails, and Retry refetches it', async () => {
    const user = userEvent.setup();
    let fail = true;
    serve({
      checklist: () =>
        fail ? jsonResponse(fixtures.errorNotFound, 500) : jsonResponse({ items: [item] }),
    });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('Couldn’t load highlights');
    fail = false;
    await user.click(within(finder()).getByRole('button', { name: 'Retry' }));
    expect(await within(finder()).findByText('1 of 4')).toBeInTheDocument();
  });

  it('offers Retry for item ranges that overrun a current item, instead of updating forever', async () => {
    const user = userEvent.setup();
    let broken = true;
    serve({
      highlights: () =>
        jsonResponse(
          broken
            ? map({
                fields: {
                  title: TITLE,
                  notes: NOTES,
                  items: [{ itemId: ITEM, updatedAt: AT, text: [[0, 100]], notes: [] }],
                },
              })
            : map(),
        ),
    });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('Couldn’t load highlights');
    broken = false;
    await user.click(within(finder()).getByRole('button', { name: 'Retry' }));
    expect(await within(finder()).findByText('1 of 4')).toBeInTheDocument();
  });

  it('keeps the editor open, focused and paused while its autosaves land', async () => {
    const user = userEvent.setup();
    const fetchMock = serve();
    renderAt(`/tasks/${ID}?q=budget`);
    await within(await findFinder()).findByText('1 of 4');

    await user.click(screen.getByRole('button', { name: 'Edit note' }));
    const notes = screen.getByRole('textbox', { name: 'Notes' });
    await user.type(notes, ' Draft');
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(screen.getByRole('textbox', { name: 'Notes' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveFocus();
    await expectStatus('Highlighting paused while editing');
  });

  it('offers Retry when the map fails, and discards a map that does not fit the text', async () => {
    const user = userEvent.setup();
    let fail = true;
    serve({
      highlights: () =>
        fail
          ? jsonResponse(fixtures.errorNotFound, 404)
          : jsonResponse(map({ fields: { title: [[0, 99]], notes: [], items: [] } })),
    });
    renderAt(`/tasks/${ID}?q=budget`);

    await expectStatus('Couldn’t load highlights');
    fail = false;
    await user.click(within(finder()).getByRole('button', { name: 'Retry' }));
    await waitFor(() => {
      expect(reading().querySelectorAll('mark')).toHaveLength(0);
    });
    await expectStatus('Couldn’t load highlights');
  });
});
