import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { SignUpForm } from './SignUpForm';

describe('SignUpForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows Passwords don't match on the confirm field", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);

    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.type(screen.getByLabelText('Confirm password'), 'demo12345');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByText("Passwords don't match")).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm password')).toHaveAccessibleDescription(
      "Passwords don't match",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('submits and succeeds when passwords match', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(jsonResponse(fixtures.user, 201)));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SignUpForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.type(screen.getByLabelText('Confirm password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/auth/signup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'demo@example.com',
          password: 'demo1234',
          confirmPassword: 'demo1234',
        }),
      }),
    );
  });

  it('shows a clear account-exists message with Sign in instead on 409', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            jsonResponse({ error: { code: 'CONFLICT', message: 'Email already registered' } }, 409),
          ),
        ),
    );
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);

    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.type(screen.getByLabelText('Confirm password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(
      await screen.findByText('An account with this email already exists.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in instead' })).toHaveAttribute(
      'href',
      '/signin',
    );
    expect(screen.queryByText('Email already registered')).not.toBeInTheDocument();
  });

  it('gives Password and Confirm password their own show/hide toggles', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(screen.getByRole('button', { name: 'Hide password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'password');

    await user.click(screen.getByRole('button', { name: 'Show confirm password' }));
    expect(screen.getByLabelText('Confirm password')).toHaveAttribute('type', 'text');
  });

  it('announces the 409 account-exists message as an alert with Sign in instead', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'CONFLICT', message: 'Email already registered' } }, 409),
        ),
    );
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.type(screen.getByLabelText('Confirm password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('An account with this email already exists.');
    expect(within(alert).getByRole('link', { name: 'Sign in instead' })).toBeInTheDocument();
  });

  it('is headed Create your account, links to Sign in, and offers no demo account', () => {
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Create your account' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Already have an account\?/)).toHaveTextContent(
      'Already have an account? Sign in',
    );
    expect(screen.queryByRole('button', { name: 'Use demo account' })).toBeNull();
  });

  it('keeps the Sign up name while it shows Creating account…', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.type(screen.getByLabelText('Confirm password'), 'demo1234');

    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    const busy = screen.getByRole('button', { name: 'Sign up' });
    await waitFor(() => {
      expect(busy).toHaveAttribute('aria-busy', 'true');
    });
    expect(within(busy).getByText('Creating account…')).toBeInTheDocument();
  });

  it('says a short password needs 8–128 characters, in words, not the schema message', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('fetch', vi.fn());
    renderWithProviders(<SignUpForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'new@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.type(screen.getByLabelText('Confirm password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign up' }));

    expect(await screen.findByText('Use 8–128 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Use 8–128 characters.');
    expect(screen.queryByText(/expected string/)).toBeNull();
  });
});
