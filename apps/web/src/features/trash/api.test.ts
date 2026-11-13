import { TrashedTask, TrashList } from '@todo/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyResponse, fixtures, jsonResponse } from '../../test/fixtures';
import { requestUrl } from '../../test/url';
import { deleteForever, emptyTrash, listTrash, restoreTask } from './api';

const id = fixtures.trashedTask.id;

describe('trash api', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists, restores, deletes forever and empties through the contract endpoints', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo, init?: RequestInit) => {
      const url = requestUrl(input);
      const method = init?.method ?? 'GET';
      if (method === 'GET' && url === '/api/trash') {
        return Promise.resolve(jsonResponse(fixtures.trashList));
      }
      if (method === 'POST' && url === `/api/tasks/${id}/restore`) {
        return Promise.resolve(jsonResponse(fixtures.task));
      }
      if (method === 'DELETE') return Promise.resolve(emptyResponse());
      return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(listTrash()).resolves.toEqual(TrashList.parse(fixtures.trashList));
    await expect(restoreTask(id)).resolves.toMatchObject({ id: fixtures.task.id });
    await expect(deleteForever(id)).resolves.toBeUndefined();
    await expect(emptyTrash()).resolves.toBeUndefined();

    const deletes = fetchMock.mock.calls
      .filter(([, init]) => (init as RequestInit | undefined)?.method === 'DELETE')
      .map(([input]) => requestUrl(input as RequestInfo));
    expect(deletes).toEqual([`/api/trash/${id}`, '/api/trash']);
    expect(TrashedTask.safeParse(fixtures.trashedTask).success).toBe(true);
  });
});
