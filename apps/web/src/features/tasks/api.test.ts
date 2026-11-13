import { Task, TaskList, TrashedTask } from '@todo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../test/fixtures';
import { requestUrl } from '../../test/url';
import { createTask, deleteTask, getTask, listTasks, moveTask, updateTask } from './api';

describe('tasks api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists, gets, creates, updates, moves and deletes', async () => {
    const task = Task.parse(fixtures.task);
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (url.startsWith('/api/tasks?') || url === '/api/tasks') {
        if (method === 'POST') return Promise.resolve(jsonResponse(task, 201));
        return Promise.resolve(jsonResponse(fixtures.taskList));
      }
      if (url.includes('/move')) return Promise.resolve(jsonResponse(task));
      if (method === 'PATCH') return Promise.resolve(jsonResponse(task));
      if (method === 'DELETE') return Promise.resolve(jsonResponse(fixtures.trashedTask));
      return Promise.resolve(jsonResponse(task));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listTasks('')).resolves.toEqual(TaskList.parse(fixtures.taskList));
    await expect(listTasks('milk')).resolves.toEqual(TaskList.parse(fixtures.taskList));
    await expect(getTask(task.id)).resolves.toEqual(task);
    await expect(createTask({ title: task.title })).resolves.toEqual(task);
    await expect(updateTask(task.id, { title: task.title })).resolves.toEqual(task);
    await expect(moveTask(task.id, { afterId: null })).resolves.toEqual(task);
    await expect(deleteTask(task.id)).resolves.toEqual(TrashedTask.parse(fixtures.trashedTask));

    expect(requestUrl(fetchMock.mock.calls[1]?.[0] as RequestInfo)).toContain('q=milk');
  });
});
