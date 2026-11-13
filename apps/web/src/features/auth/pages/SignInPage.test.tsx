import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { SignInPage } from './SignInPage';

describe('SignInPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the sign-in landing form', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.health)));
    renderWithProviders(<SignInPage />, { route: '/signin' });
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('presents the product beside the form: one wordmark, the value, a workspace preview', () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.health)));
    renderWithProviders(<SignInPage />, { route: '/signin' });

    expect(screen.getAllByText('Tuck', { exact: true })).toHaveLength(1);
    expect(screen.queryByRole('banner')).toBeNull();
    const headline = screen.getByText('Keep the work in view.');

    expect(headline.innerHTML).toMatch(/^Keep the work\s*<br>\s*in view\.$/);
    expect(screen.getByText('Tasks and notes, kept together.')).toBeInTheDocument();
    const preview = screen.getByRole('figure', { name: 'Workspace preview' });
    expect(preview.querySelectorAll('li').length).toBeGreaterThan(2);
    for (const point of [
      'Capture tasks inline',
      'Keep notes with the task',
      'Set priorities, stay focused',
    ]) {
      expect(screen.getByText(point)).toBeInTheDocument();
    }
    expect(screen.getByRole('main')).toContainElement(
      screen.getByRole('button', { name: 'Sign in' }),
    );
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });
});
