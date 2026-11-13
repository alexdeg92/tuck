import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { RequireSession } from './RequireSession';

describe('RequireSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders children when the session is valid', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.user)));
    renderWithProviders(
      <RequireSession>
        <div>Private</div>
      </RequireSession>,
      { route: '/tasks' },
    );

    expect(await screen.findByText('Private')).toBeInTheDocument();
  });

  it('redirects to sign-in when unauthenticated', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'UNAUTHENTICATED', message: 'Sign in required' } }, 401),
        ),
    );

    renderWithProviders(
      <Routes>
        <Route
          path="/tasks"
          element={
            <RequireSession>
              <div>Private</div>
            </RequireSession>
          }
        />
        <Route path="/signin" element={<div>Sign in page</div>} />
      </Routes>,
      { route: '/tasks' },
    );

    await waitFor(() => expect(screen.getByText('Sign in page')).toBeInTheDocument());
  });
});
