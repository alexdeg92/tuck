import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { SignInForm } from './SignInForm';

describe('SignInForm', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows validation errors for empty fields', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  });

  it('submits credentials and calls onSuccess', async () => {
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.user)));

    renderWithProviders(<SignInForm onSuccess={onSuccess} />);

    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalled();
    });
  });

  it('prefills email from the location state', () => {
    renderWithProviders(<SignInForm onSuccess={() => undefined} />, {
      route: { pathname: '/signin', state: { email: 'demo@example.com' } },
    });

    expect(screen.getByLabelText('Email')).toHaveValue('demo@example.com');
  });

  it('shows the server error message', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Invalid email or password',
            },
          },
          401,
        ),
      ),
    );

    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Invalid email or password')).toBeInTheDocument();
  });

  it('shows and hides the password with a labelled toggle', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    const password = screen.getByLabelText('Password');
    await user.type(password, 'demo1234');

    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    await user.click(show);
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('demo1234');

    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.click(hide);
    expect(password).toHaveAttribute('type', 'password');
  });

  it('fills the demo account without signing in, and says so', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    expect(screen.getByText('Fills the form. You choose when to sign in.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use demo account' }));

    expect(screen.getByLabelText('Email')).toHaveValue('demo@example.com');
    expect(screen.getByLabelText('Password')).toHaveValue('demo1234');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Demo account filled. Sign in when ready.',
    );
    expect(screen.getByText('Demo filled')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers no demo account where the build turns it off (production)', () => {
    renderWithProviders(<SignInForm onSuccess={() => undefined} showDemo={false} />);
    expect(screen.queryByRole('button', { name: 'Use demo account' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Fills the form/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('is headed Sign in and links to Create an account', () => {
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument();
    expect(screen.getByText(/New to Tuck\?/)).toHaveTextContent('New to Tuck? Create an account');
    expect(screen.getByRole('link', { name: 'Create an account' })).toHaveAttribute(
      'href',
      '/signup',
    );
  });

  it('moves focus to the first invalid field on an invalid submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Email')).toHaveFocus();
    });
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('keeps the Sign in name and width, shows a spinner and Signing in…, and announces it', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'demo1234');

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    const busy = screen.getByRole('button', { name: 'Sign in' });
    await waitFor(() => {
      expect(busy).toHaveAttribute('aria-busy', 'true');
    });
    expect(within(busy).getByText('Signing in…')).toBeInTheDocument();
    expect(busy.querySelector('svg[class*="spinner"]')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Signing in…');
  });

  it('announces a refused sign-in as an alert', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse(
            { error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' } },
            401,
          ),
        ),
    );
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('says a short password needs 8–128 characters', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SignInForm onSuccess={() => undefined} />);
    await user.type(screen.getByLabelText('Email'), 'demo@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Use 8–128 characters.')).toBeInTheDocument();
  });
});
