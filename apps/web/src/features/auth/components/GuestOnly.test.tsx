import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { GuestOnly } from './RequireSession';

describe('GuestOnly', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('redirects signed-in users to tasks', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(fixtures.user))),
    );
    renderWithProviders(
      <Routes>
        <Route
          path="/signin"
          element={
            <GuestOnly>
              <div>Guest</div>
            </GuestOnly>
          }
        />
        <Route path="/tasks" element={<div>Tasks page</div>} />
      </Routes>,
      { route: '/signin' },
    );

    await waitFor(() => expect(screen.getByText('Tasks page')).toBeInTheDocument());
  });
});
