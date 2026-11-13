import { Task } from '@todo/contracts';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { createTestQueryClient, renderWithProviders } from '../../../test/query';
import { bodyObject, sentBodies } from '../../../test/requests';
import { requestUrl } from '../../../test/url';
import { taskKeys } from '../keys';
import { TaskDetailPage } from './TaskDetailPage';

const seeded = Task.parse({ ...fixtures.task, title: 'Cached title', notes: 'Cached notes' });
const fresh = {
  ...seeded,
  title: 'Server title',
  notes: 'Server notes',
  updatedAt: '2026-11-11T10:00:00.000Z',
};

function stubDetail() {
  let answer: (response: Response) => void = () => undefined;
  const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
    const url = requestUrl(input);
    if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
    if (init?.method === 'PATCH') {
      return Promise.resolve(jsonResponse({ ...fresh, ...bodyObject(init) }));
    }
    return new Promise<Response>((resolve) => {
      answer = (response) => {
        resolve(response);
      };
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    answer: (response: Response) => {
      answer(response);
    },
  };
}

function renderSeeded() {
  const client = createTestQueryClient();
  client.setQueryData(taskKeys.list(''), { items: [seeded] });
  return renderWithProviders(
    <Routes>
      <Route path="/tasks/:id" element={<TaskDetailPage />} />
    </Routes>,
    { route: `/tasks/${seeded.id}`, client },
  );
}

describe('a task opened from an older list copy', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the server’s title and notes once they arrive, and the next save is based on them', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    renderSeeded();
    expect(screen.getByLabelText('Notes')).toHaveValue('Cached notes');

    server.answer(jsonResponse(fresh));

    await waitFor(() => {
      expect(screen.getByLabelText('Notes')).toHaveValue('Server notes');
    });
    expect(screen.getByLabelText('Title')).toHaveValue('Server title');
    await user.type(screen.getByLabelText('Notes'), ' + mine');
    await user.tab();
    await waitFor(() => {
      expect(sentBodies(server.fetchMock, 'PATCH')).toEqual([
        { notes: 'Server notes + mine', expectedUpdatedAt: fresh.updatedAt },
      ]);
    });
  });

  it('keeps what the user is typing when the server copy arrives meanwhile', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    renderSeeded();

    await user.type(screen.getByLabelText('Notes'), ' + typing');
    server.answer(jsonResponse(fresh));

    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('Server title');
    });
    expect(screen.getByLabelText('Notes')).toHaveValue('Cached notes + typing');
  });

  it('keeps unsaved edits when another field of the task changes (Task settings), and saves on the new version', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    const { client } = renderSeeded();
    server.answer(jsonResponse(fresh));
    await waitFor(() => {
      expect(screen.getByLabelText('Notes')).toHaveValue('Server notes');
    });

    await user.type(screen.getByLabelText('Notes'), ' + mine');
    const changed = { ...fresh, priority: 'low' as const, updatedAt: '2026-11-11T10:30:00.000Z' };
    act(() => {
      client.setQueryData(taskKeys.detail(seeded.id), changed);
    });

    expect(screen.getByLabelText('Notes')).toHaveValue('Server notes + mine');
    await user.tab();
    await waitFor(() => {
      expect(sentBodies(server.fetchMock, 'PATCH')).toEqual([
        { notes: 'Server notes + mine', expectedUpdatedAt: changed.updatedAt },
      ]);
    });
  });

  it('never says Saved for edits made before the server copy arrived', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    renderSeeded();

    await user.type(screen.getByLabelText('Notes'), ' + typing');
    server.answer(jsonResponse(fresh));
    await waitFor(() => {
      expect(screen.getByLabelText('Title')).toHaveValue('Server title');
    });

    expect(screen.getByLabelText('Notes')).toHaveValue('Cached notes + typing');
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('a late initial read never rolls back notes the server has already acknowledged', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    renderSeeded();

    await user.type(screen.getByLabelText('Notes'), ' + new');
    await user.tab();
    await waitFor(() => {
      expect(sentBodies(server.fetchMock, 'PATCH')).toHaveLength(1);
    });
    expect(await screen.findByText('Saved')).toBeInTheDocument();

    server.answer(jsonResponse(seeded));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.getByLabelText('Notes')).toHaveValue('Cached notes + new');
  });

  it.each([
    [404, fixtures.errorNotFound],
    [403, { error: { code: 'FORBIDDEN', message: 'You cannot open this task' } }],
  ])('replaces the editor with the error when the task’s read answers %i', async (status, body) => {
    const server = stubDetail();
    renderSeeded();
    expect(screen.getByLabelText('Title')).toBeInTheDocument();

    server.answer(jsonResponse(body, status));

    expect(await screen.findByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('recovers with Retry once the read succeeds', async () => {
    const user = userEvent.setup();
    const server = stubDetail();
    renderSeeded();
    server.answer(jsonResponse(fixtures.errorNotFound, 404));
    await user.click(await screen.findByRole('button', { name: /Retry/ }));

    server.answer(jsonResponse(fresh));

    expect(await screen.findByLabelText('Title')).toHaveValue('Server title');
  });

  it('keeps last-known content on another failure, but says it could not refresh', async () => {
    const server = stubDetail();
    renderSeeded();

    server.answer(jsonResponse({ error: { code: 'INTERNAL', message: 'down' } }, 500));

    expect(await screen.findByText('Couldn’t refresh this task.')).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Cached title');
  });
});
