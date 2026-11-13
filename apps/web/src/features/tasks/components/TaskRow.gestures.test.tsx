import { Task } from '@todo/contracts';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse, trashedResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TaskList } from './TaskList';

/** Deletion is owned by the page; these list tests never delete. */
const idleDeletion = { send: vi.fn(), pending: false };

const openTask = Task.parse(fixtures.task);

function stubPhoneTier(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query.includes('600px') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function stubApi({ failPatch = false }: { failPatch?: boolean } = {}) {
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
    if (init?.method === 'PATCH') {
      if (failPatch) return Promise.resolve(jsonResponse(fixtures.errorValidation, 400));
      const raw = typeof init.body === 'string' ? init.body : '{}';
      const body = JSON.parse(raw) as { status?: string };
      return Promise.resolve(
        jsonResponse({
          ...openTask,
          status: body.status ?? openTask.status,
        }),
      );
    }
    if (init?.method === 'DELETE') return Promise.resolve(trashedResponse(openTask));
    if (url.startsWith('/api/tasks')) return Promise.resolve(jsonResponse(fixtures.taskList));
    return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function surfaceOf(row: HTMLElement): HTMLElement {
  return row.querySelector('[data-done]') as HTMLElement;
}

function patchBodies(fetchMock: ReturnType<typeof stubApi>): string[] {
  return fetchMock.mock.calls
    .map((call) => call[1] as RequestInit | undefined)
    .filter((init) => init?.method === 'PATCH')
    .map((init) => (typeof init?.body === 'string' ? init.body : ''));
}

/** Status regions other than dnd-kit's own reorder announcer (e2e reads that one by role). */
function gestureStatusRegions(): HTMLElement[] {
  return screen.queryAllByRole('status').filter((node) => !node.id.startsWith('DndLiveRegion'));
}

/** The list's one gesture live region: polite, with no status role to collide with dnd-kit's. */
function gestureAnnouncer(): HTMLElement {
  const regions = [...document.querySelectorAll<HTMLElement>('[aria-live="polite"]:not([role])')];
  expect(regions).toHaveLength(1);
  return regions[0] as HTMLElement;
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

/** dx < 0 swipes left (complete/reopen), dx > 0 right (move to trash): see `swipeAction`. */
function swipe(row: HTMLElement, dx: number) {
  const surface = surfaceOf(row);
  fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
  fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200 + dx, clientY: 40 });
  fireEvent.pointerUp(surface, { pointerId: 1, clientX: 200 + dx, clientY: 40 });
}

describe('TaskRow phone gestures', () => {
  beforeEach(() => {
    stubPhoneTier(true);
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('keeps row-scoped user-select and touch-callout suppression in CSS', () => {
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.touchRow,\s*\.touchRow \*\s*\{[^}]*user-select:\s*none/s);
    expect(css).toMatch(/-webkit-touch-callout:\s*none/);
    expect(css).toMatch(/touch-action:\s*pan-y pinch-zoom/);
    expect(css).toMatch(/settingsPopover[\s\S]*user-select:\s*text/);
  });

  it('opens the shared options sheet with title and Open notes from Task options', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />, {
      route: '/tasks',
    });

    await user.click(screen.getByRole('button', { name: 'Task options' }));
    const panel = await screen.findByRole('dialog', { name: 'Task settings' });
    expect(panel.querySelector('.settingsTaskName')).toHaveTextContent(openTask.title);
    expect(screen.getByRole('button', { name: 'Open notes' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Mark as done' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeInTheDocument();
  });

  it('opens row options from the keyboard with focus inside the sheet, and Escape returns it', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />, {
      route: '/tasks',
    });

    screen.getByRole('button', { name: 'Task options' }).focus();
    await user.keyboard('{Enter}');
    const panel = await screen.findByRole('dialog', { name: 'Task settings' });
    await waitFor(() => {
      expect(panel.contains(document.activeElement)).toBe(true);
    });

    panel.hidePopover(); // what Escape does to an auto popover
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Task options' }));
    });
  });

  it('shows a 44px Task options control that opens Task settings', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);

    const options = screen.getByRole('button', { name: 'Task options' });
    expect(options.className).toMatch(/rowMore/);
    await user.click(options);
    expect(await screen.findByRole('dialog', { name: 'Task settings' })).toBeInTheDocument();
  });

  it('announces swipe and hold through one shared polite region before the lists, with no per-row or extra status role', async () => {
    stubApi();
    const rows = [0, 1, 2].map((index) =>
      Task.parse({
        ...fixtures.task,
        id: `00000000-0000-4000-8000-00000000000${String(index)}`,
        title: `Task ${String(index)}`,
      }),
    );
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={rows} q="" />);

    expect(gestureStatusRegions()).toEqual([]);
    const announcer = gestureAnnouncer();
    // Before the lists, so its absolute srOnly box never sits below a long list and grows the page.
    const firstList = screen.getByRole('list', { name: 'Open tasks' });
    expect(
      announcer.compareDocumentPosition(firstList) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    for (const row of screen.getAllByRole('listitem')) {
      expect(within(row).queryByRole('status')).toBeNull();
    }

    const surface = surfaceOf(screen.getByRole('listitem', { name: 'Task 1' }));
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    await advance(460);
    expect(gestureAnnouncer()).toHaveTextContent('Release for task options.');
    fireEvent.pointerCancel(surface, { pointerId: 1, clientX: 80, clientY: 40 });
    await advance(10);
    expect(gestureAnnouncer()).toHaveTextContent('');
  });

  it('recognises a hold at 450ms, shows the held state, and opens options on release', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    // shouldAdvanceTime lets real time drift the fake clock, so check well before 450ms.
    await advance(400);
    expect(surface).not.toHaveAttribute('data-held');
    await advance(50);
    expect(surface).toHaveAttribute('data-held', 'true');
    expect(screen.getByRole('button', { name: 'Task options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 80, clientY: 40 });
    await advance(50);
    expect(surface).not.toHaveAttribute('data-held');
    expect(await screen.findByRole('button', { name: 'Task options' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it.each([
    [
      'a move (which drags instead)',
      (surface: HTMLElement) => {
        fireEvent.pointerMove(surface, { pointerId: 1, clientX: 80, clientY: 51 });
      },
    ],
    [
      'a scroll',
      () => {
        fireEvent.scroll(document.body);
      },
    ],
    [
      'pointercancel',
      (surface: HTMLElement) => {
        fireEvent.pointerCancel(surface, { pointerId: 1, clientX: 80, clientY: 40 });
      },
    ],
  ])('opens no options sheet when %s comes before release', async (_name, interrupt) => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    await advance(460);
    expect(surface).toHaveAttribute('data-held', 'true');
    interrupt(surface);
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 80, clientY: 49 });
    await advance(50);

    expect(surface).not.toHaveAttribute('data-held');
    expect(screen.getByRole('button', { name: 'Task options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it.each([
    ['right', 80, 'left', 'flex-start', 'Delete', 'delete', 'Release to delete task.'],
    ['left', -80, 'right', 'flex-end', 'Complete', 'complete', 'Release to complete task.'],
  ])(
    'labels the armed %s swipe (dx %i) at the revealed %s edge',
    (_direction, dx, revealed, justify, idleLabel, action, announcement) => {
      stubApi();
      renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
      const row = screen.getByRole('listitem', { name: openTask.title });
      const surface = surfaceOf(row);
      const underlay = row.querySelector('[data-armed]') as HTMLElement;

      fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200 + dx / 4, clientY: 40 });
      expect(underlay).toHaveAttribute('data-armed', 'false');
      expect(underlay).toHaveTextContent(new RegExp(`^${idleLabel}$`));
      expect(underlay).toHaveAttribute('data-action', action);
      fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200 + dx, clientY: 40 });

      expect(underlay).toHaveAttribute('data-armed', 'true');
      expect(underlay).toHaveAttribute('data-side', revealed);
      expect(underlay).toHaveAttribute('data-action', action);
      expect(underlay).toHaveTextContent(/^Release$/);
      expect(gestureAnnouncer()).toHaveTextContent(announcement);
      const css = readFileSync(
        join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
        'utf8',
      );
      expect(css).toMatch(
        new RegExp(
          `\\.swipeUnderlay\\[data-side='${revealed}'\\]\\s*\\{[^}]*justify-content:\\s*${justify}`,
        ),
      );
    },
  );

  it('shows the swipe underlay only during a horizontal swipe or its settle, never at rest', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const underlay = row.querySelector('[data-armed]') as HTMLElement;
    // At rest (and so while a lifecycle phase fades the surface in) the underlay is gated off.
    expect(underlay).toHaveAttribute('data-gesture', 'idle');

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    expect(underlay).toHaveAttribute('data-gesture', 'pressing');
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 240, clientY: 40 });
    expect(underlay).toHaveAttribute('data-gesture', 'swiping');

    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.swipeUnderlay:not\(\[data-gesture='swiping'\], \[data-gesture='settling'\]\)\s*\{[^}]*visibility:\s*hidden/,
    );
  });

  it('labels a completed row Reopen until the swipe arms', () => {
    stubApi();
    const doneTask = { ...openTask, status: 'done' as const };
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[doneTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const underlay = row.querySelector('[data-armed]') as HTMLElement;

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 170, clientY: 40 });
    expect(underlay).toHaveTextContent(/^Reopen$/);
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 110, clientY: 40 });
    expect(underlay).toHaveTextContent(/^Release$/);
    expect(gestureAnnouncer()).toHaveTextContent('Release to reopen task.');
  });

  it('toggles completion when a swipe to the left passes the threshold', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });

    swipe(row, -80);
    await waitFor(() => {
      const patched = fetchMock.mock.calls.some((call) => {
        const init = call[1] as RequestInit | undefined;
        return (
          init?.method === 'PATCH' &&
          typeof init.body === 'string' &&
          init.body.includes('"status":"done"')
        );
      });
      expect(patched).toBe(true);
    });
    expect(await screen.findByText('Completed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('cancels native horizontal touch scrolling but preserves vertical movement and taps', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));
    const move = (x: number, y: number) => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: x, clientY: y }] });
      fireEvent(surface, event);
      return event.defaultPrevented;
    };
    expect(move(100, 40)).toBe(false);
    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    expect(move(83, 40)).toBe(false);
    expect(move(81, 80)).toBe(false);
    expect(move(110, 41)).toBe(true);
    fireEvent.pointerCancel(surface, { pointerId: 1 });
    expect(move(110, 41)).toBe(false);
  });

  it('keeps a swipe going when capture moves from the touched title to the row', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const title = within(row).getByText(openTask.title);

    fireEvent.pointerDown(title, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(title, { pointerId: 1, clientX: 180, clientY: 40 });
    // Touch input is implicitly captured by the touched element; the hook's capture releases it.
    fireEvent.lostPointerCapture(title, { pointerId: 1 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 100, clientY: 40 });
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 100, clientY: 40 });

    await waitFor(() => {
      expect(patchBodies(fetchMock)).toEqual(['{"status":"done"}']);
    });
  });

  it('does not mutate on a short drag below the threshold', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });

    swipe(row, 20);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(
      fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH'),
    ).toBe(false);
  });

  it('resets an armed swipe on pointercancel without a status mutation', async () => {
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 200, clientY: 40 });
    expect(surface.style.transform).toContain('120px');
    fireEvent.pointerCancel(surface, { pointerId: 1, clientX: 200, clientY: 40 });
    await act(async () => {
      vi.advanceTimersByTime(400);
      await Promise.resolve();
    });

    expect(patchBodies(fetchMock)).toEqual([]);
    expect(surface.style.transform).not.toContain('120px');
  });

  it('offers Undo after a successful swipe and undoes with another status mutation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    swipe(screen.getByRole('listitem', { name: openTask.title }), -80);
    const undo = await screen.findByRole('button', { name: 'Undo' });
    await user.click(undo);
    await waitFor(() => {
      const statuses = fetchMock.mock.calls
        .filter((call) => (call[1] as RequestInit | undefined)?.method === 'PATCH')
        .map((call) => {
          const body = (call[1] as RequestInit).body;
          return typeof body === 'string' ? body : '';
        });
      expect(statuses.some((body) => body.includes('"status":"todo"'))).toBe(true);
    });
  });

  it('shows a labelled retry when the swipe mutation fails', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi({ failPatch: true });
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    swipe(screen.getByRole('listitem', { name: openTask.title }), -80);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not update. Retry');
    stubApi();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  it('moves the task to the trash from Task options, with no confirmation', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi();
    const deletion = { send: vi.fn(), pending: false };
    renderWithProviders(<TaskList deletion={deletion} tasks={[openTask]} q="" />);
    await user.click(screen.getByRole('button', { name: 'Task options' }));
    await user.click(screen.getByRole('button', { name: 'Move to trash' }));

    expect(deletion.send).toHaveBeenCalledWith(openTask);
    expect(screen.queryByRole('dialog', { name: 'Delete task?' })).not.toBeInTheDocument();
  });

  it('moves the task to the trash on a swipe to the right, with no confirmation and no status change', async () => {
    const fetchMock = stubApi();
    const deletion = { send: vi.fn(), pending: false };
    renderWithProviders(<TaskList deletion={deletion} tasks={[openTask]} q="" />);

    swipe(screen.getByRole('listitem', { name: openTask.title }), 80);
    await advance(200);

    expect(deletion.send).toHaveBeenCalledTimes(1);
    expect(deletion.send).toHaveBeenCalledWith(openTask);
    expect(patchBodies(fetchMock)).toEqual([]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a swipe to the left toggles and never trashes; a short swipe to the right does neither', async () => {
    const fetchMock = stubApi();
    const deletion = { send: vi.fn(), pending: false };
    renderWithProviders(<TaskList deletion={deletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });

    swipe(row, 20);
    await advance(200);
    expect(deletion.send).not.toHaveBeenCalled();
    expect(patchBodies(fetchMock)).toEqual([]);

    swipe(row, -80);
    await waitFor(() => {
      expect(patchBodies(fetchMock)).toEqual(['{"status":"done"}']);
    });
    expect(deletion.send).not.toHaveBeenCalled();
  });

  it('shows the trash side as the Complete underlay in red, with Delete and no icon', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const underlay = row.querySelector('[data-armed]') as HTMLElement;

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 170, clientY: 40 });
    expect(underlay).toHaveAttribute('data-action', 'complete');
    expect(underlay.querySelector('svg')).not.toBeNull();
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 230, clientY: 40 });
    expect(underlay).toHaveAttribute('data-action', 'delete');
    expect(underlay).toHaveTextContent(/^Delete$/);
    expect(underlay.querySelector('svg')).toBeNull();
    fireEvent.pointerCancel(surface, { pointerId: 1 });

    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
      'utf8',
    );
    expect(css).toMatch(
      /\.swipeUnderlay\[data-action='delete'\]\s*\{\s*background:\s*var\(--color-danger\);\s*\}/,
    );
  });

  it('keeps a cancelled swipe to the trash red while it settles back, never flashing Complete', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const underlay = row.querySelector('[data-armed]') as HTMLElement;

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 200, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 320, clientY: 40 });
    expect(underlay).toHaveAttribute('data-armed', 'true');
    fireEvent.pointerCancel(surface, { pointerId: 1 });

    // Settling: the row slides back over the same red underlay, on the same side.
    expect(underlay).toHaveAttribute('data-gesture', 'settling');
    expect(underlay).toHaveAttribute('data-action', 'delete');
    expect(underlay).toHaveAttribute('data-side', 'left');
    expect(underlay).toHaveTextContent(/^Delete$/);
    expect(underlay.querySelector('svg')).toBeNull();
    expect(surface.style.transform).toContain('translate3d(0px');
  });

  it('keeps a cancelled swipe to complete on its own side while it settles back', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    const underlay = row.querySelector('[data-armed]') as HTMLElement;

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 300, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 260, clientY: 40 });
    fireEvent.pointerCancel(surface, { pointerId: 1 });

    expect(underlay).toHaveAttribute('data-gesture', 'settling');
    expect(underlay).toHaveAttribute('data-action', 'complete');
    expect(underlay).toHaveAttribute('data-side', 'right');
  });

  it('still toggles completion from the checkbox without a gesture', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const fetchMock = stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    await user.click(screen.getByRole('checkbox', { name: `Mark ${openTask.title} as done` }));
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some((call) => {
          const init = call[1] as RequestInit | undefined;
          return (
            init?.method === 'PATCH' &&
            typeof init.body === 'string' &&
            init.body.includes('"status":"done"')
          );
        }),
      ).toBe(true);
    });
  });

  it('suppresses the native context menu on gesture-bearing rows', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it('keeps the title link navigable on a plain tap (no premature pointer capture)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const link = screen.getByRole('link', { name: openTask.title });
    expect(link).toHaveAttribute('href', `/tasks/${openTask.id}`);
    await user.click(link);
    // A tap must not leave suppressNavigation stuck; the link stays enabled for routing.
    expect(link.getAttribute('aria-disabled')).toBeNull();
  });

  it('keeps the hold through a 9px wobble, and an 11px move before 450ms cancels it', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 80, clientY: 49 });
    await advance(460);
    expect(surface).toHaveAttribute('data-held', 'true');
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 80, clientY: 49 });
    await advance(50);

    fireEvent.pointerDown(surface, { pointerId: 2, clientX: 80, clientY: 40, button: 0 });
    fireEvent.pointerMove(surface, { pointerId: 2, clientX: 80, clientY: 51 });
    await advance(460);
    expect(surface).not.toHaveAttribute('data-held');
    fireEvent.pointerUp(surface, { pointerId: 2, clientX: 80, clientY: 51 });
  });

  it('drags the task when the finger moves after a 450ms hold, and opens no options sheet', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      clientX: 80,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    await advance(460);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 80, clientY: 70 });
    await advance(20);

    expect(surface).toHaveAttribute('data-dragging', 'true');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 80, clientY: 70 });
    await advance(50);
    expect(surface).toHaveAttribute('data-dragging', 'false');
    expect(screen.getByRole('button', { name: 'Task options' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('holds the page still once the hold arms, so the drag is not taken over by a scroll', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const surface = surfaceOf(screen.getByRole('listitem', { name: openTask.title }));
    // A real touchmove always carries its touches (#15's horizontal-swipe listener reads them):
    // one finger, still where it pressed.
    const touchMove = () => {
      const event = new Event('touchmove', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: [{ clientX: 80, clientY: 40 }] });
      surface.dispatchEvent(event);
      return event.defaultPrevented;
    };

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    expect(touchMove()).toBe(false);
    await advance(460);
    expect(touchMove()).toBe(true);
    fireEvent.pointerUp(surface, { pointerId: 1, clientX: 80, clientY: 40 });
    await advance(50);
    expect(touchMove()).toBe(false);
  });

  it('ignores holds and moves on the open options popover', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const surface = surfaceOf(row);
    fireEvent.click(within(row).getByRole('button', { name: 'Task options' }));
    const popover = await waitFor(() => {
      const node = row.querySelector('[popover]');
      if (!(node instanceof HTMLElement)) throw new Error('no popover yet');
      return node;
    });

    fireEvent.pointerDown(popover, {
      pointerId: 1,
      clientX: 80,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    await advance(460);
    expect(surface).not.toHaveAttribute('data-held');
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 80, clientY: 90 });
    await advance(20);

    expect(surface).toHaveAttribute('data-dragging', 'false');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 80, clientY: 90 });
  });

  it('never drags a completed task from a hold: moving after the hold only cancels it', async () => {
    stubApi();
    const done = { ...openTask, status: 'done' as const, completedAt: openTask.updatedAt };
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[done]} q="" />);
    fireEvent.click(screen.getByText('Completed'));
    const surface = surfaceOf(screen.getByRole('listitem', { name: done.title }));

    fireEvent.pointerDown(surface, { pointerId: 1, clientX: 80, clientY: 40, button: 0 });
    await advance(460);
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 80, clientY: 70 });
    fireEvent.pointerMove(surface, { pointerId: 1, clientX: 80, clientY: 70 });
    await advance(20);

    expect(surface).toHaveAttribute('data-dragging', 'false');
    expect(surface).not.toHaveAttribute('data-held');
  });
});

describe('TaskRow desktop Delete key', () => {
  beforeEach(() => {
    stubPhoneTier(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('moves the focused row to the trash with the Delete key, and only from the row itself', async () => {
    const user = userEvent.setup();
    stubApi();
    const deletion = { send: vi.fn(), pending: false };
    renderWithProviders(<TaskList deletion={deletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });

    within(row).getByRole('checkbox').focus();
    await user.keyboard('{Delete}');
    expect(deletion.send).not.toHaveBeenCalled();

    within(row).getByRole('link', { name: openTask.title }).focus();
    await user.keyboard('{Delete}');
    expect(deletion.send).toHaveBeenCalledTimes(1);
    expect(deletion.send).toHaveBeenCalledWith(openTask);
  });
});

describe('TaskRow desktop drag from anywhere on the row', () => {
  beforeEach(() => {
    stubPhoneTier(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts a drag from the title once the pointer moves 6px', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const link = within(row).getByRole('link', { name: openTask.title });

    fireEvent.pointerDown(link, {
      pointerId: 1,
      clientX: 200,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 44 });
    expect(surfaceOf(row)).toHaveAttribute('data-dragging', 'false');
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 60 });

    await waitFor(() => {
      expect(surfaceOf(row)).toHaveAttribute('data-dragging', 'true');
    });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 60 });
  });

  it('raises the whole moving row above its neighbours while it drags (design-pr30c occlusion)', async () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const link = within(row).getByRole('link', { name: openTask.title });
    expect(row.style.zIndex).toBe('');

    fireEvent.pointerDown(link, {
      pointerId: 1,
      clientX: 200,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 60 });

    await waitFor(() => {
      expect(row.style.zIndex).not.toBe('');
    });
    expect(row.style.position).toBe('relative');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 60 });
  });

  it('never starts a drag from the checkbox', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const row = screen.getByRole('listitem', { name: openTask.title });
    const checkbox = within(row).getByRole('checkbox');

    fireEvent.pointerDown(checkbox, {
      pointerId: 1,
      clientX: 60,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 60, clientY: 80 });

    expect(surfaceOf(row)).toHaveAttribute('data-dragging', 'false');
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 60, clientY: 80 });
  });

  it('keeps the title a plain, non-draggable link that the whole row stretches', () => {
    stubApi();
    renderWithProviders(<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />);
    const link = within(screen.getByRole('listitem', { name: openTask.title })).getByRole('link', {
      name: openTask.title,
    });

    expect(link).toHaveAttribute('draggable', 'false');
    const css = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'TaskRow.module.css'),
      'utf8',
    );
    expect(css).toMatch(/\.link::after\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
  });

  it('does not open the task from the click that ends a drag', async () => {
    stubApi();
    renderWithProviders(
      <Routes>
        <Route path="/" element={<TaskList deletion={idleDeletion} tasks={[openTask]} q="" />} />
        <Route path="/tasks/:id" element={<p>Opened</p>} />
      </Routes>,
    );
    const row = screen.getByRole('listitem', { name: openTask.title });
    const link = within(row).getByRole('link', { name: openTask.title });

    fireEvent.pointerDown(link, {
      pointerId: 1,
      clientX: 200,
      clientY: 40,
      button: 0,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, { pointerId: 1, clientX: 200, clientY: 60 });
    await waitFor(() => {
      expect(surfaceOf(row)).toHaveAttribute('data-dragging', 'true');
    });
    fireEvent.pointerUp(document, { pointerId: 1, clientX: 200, clientY: 60 });
    fireEvent.click(link);

    expect(screen.queryByText('Opened')).not.toBeInTheDocument();
    fireEvent.click(link);
    expect(await screen.findByText('Opened')).toBeInTheDocument();
  });
});
