import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { SignUpPage } from './SignUpPage';

describe('SignUpPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the sign-up form', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.health)));
    renderWithProviders(<SignUpPage />, { route: '/signup' });
    expect(screen.getByRole('button', { name: 'Sign up' })).toBeInTheDocument();
  });
});
