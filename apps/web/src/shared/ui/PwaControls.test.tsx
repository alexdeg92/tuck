import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InstallHint } from './InstallHint';
import { PwaControls } from './PwaControls';
import { setReadyUpdate } from '../pwa/update';
import { ConnectivityStatus } from './ConnectivityStatus';

afterEach(() => {
  setReadyUpdate(null);
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
describe('install and connectivity controls', () => {
  it('offers install only after the browser offers it, invokes it and hides after installation', async () => {
    render(<PwaControls />);
    expect(screen.queryByText('Install app')).toBeNull();
    const prompt = vi.fn().mockResolvedValue({ outcome: 'accepted' });
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByText('Install app'));
    });
    expect(prompt).toHaveBeenCalledOnce();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByText('Install app')).toBeNull();
  });
  it('dismisses and remembers the iOS hint', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone Safari');
    const view = render(<InstallHint />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install hint' }));
    expect(localStorage.getItem('tuck:ios-hint')).toBe('dismissed');
    view.unmount();
    render(<InstallHint />);
    expect(screen.queryByText(/Share/)).toBeNull();
  });
  it('shows offline feedback outside the session gate and clears on reconnect', async () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    render(<ConnectivityStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('offline');
    online.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    await waitFor(() => {
      expect(screen.queryByRole('status')).toBeNull();
    });
  });
  it('shows the update notice once', () => {
    sessionStorage.setItem('tuck:updated', 'release');
    render(<ConnectivityStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('Updated to v');
    expect(sessionStorage.getItem('tuck:updated')).toBeNull();
  });
});

it('offers a busy Reload action and retains the notice when saving fails', async () => {
  let rejectSave: ((error: Error) => void) | undefined;
  const retry = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  setReadyUpdate('next-release', retry);
  render(<ConnectivityStatus />);
  expect(screen.getByRole('status')).toHaveTextContent('A new version is ready');
  const reload = screen.getByRole('button', { name: 'Reload' });
  fireEvent.click(reload);
  expect(retry).toHaveBeenCalledOnce();
  expect(reload).toBeDisabled();
  expect(reload).toHaveAttribute('aria-busy', 'true');
  await act(async () => {
    rejectSave?.(new Error('Unsaved notes'));
  });
  expect(reload).toBeEnabled();
  expect(screen.getByRole('status')).toHaveTextContent('A new version is ready');
});
