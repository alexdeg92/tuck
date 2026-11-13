import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { requestUrl } from '../../../test/url';
import { TaskDetailPage } from './TaskDetailPage';

describe('TaskDetailPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads a task for editing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((input: RequestInfo) => {
        const url = requestUrl(input);
        if (url.startsWith('/api/tasks/')) return Promise.resolve(jsonResponse(fixtures.task));
        if (url.startsWith('/api/health')) return Promise.resolve(jsonResponse(fixtures.health));
        return Promise.resolve(jsonResponse(fixtures.errorNotFound, 404));
      }),
    );

    renderWithProviders(
      <Routes>
        <Route path="/tasks/:id" element={<TaskDetailPage />} />
      </Routes>,
      { route: `/tasks/${fixtures.task.id}` },
    );

    expect(await screen.findByLabelText('Title')).toHaveValue('Draft the quarterly report');
    expect(screen.getByRole('checkbox', { name: 'Mark as done' })).toBeInTheDocument();
  });
});
