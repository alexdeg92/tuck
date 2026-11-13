import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotificationItem, NotificationProvider } from './NotificationStack';

describe('shared notification placement', () => {
  it('sorts by priority, caps at three, promotes queued notices and cleans up', async () => {
    function Notices({ error }: { error: boolean }) {
      return (
        <NotificationProvider>
          <NotificationItem priority={30}>
            <div role="status">Updated</div>
          </NotificationItem>
          <NotificationItem priority={20}>
            <div role="status">Offline</div>
          </NotificationItem>
          <NotificationItem priority={10}>
            <div role="status">Undo</div>
          </NotificationItem>
          {error ? (
            <NotificationItem priority={0}>
              <div role="alert">Retry</div>
            </NotificationItem>
          ) : null}
        </NotificationProvider>
      );
    }
    const view = render(<Notices error />);
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
        'Undo',
        'Offline',
      ]);
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Retry');
    expect(screen.queryByRole('status', { name: 'Updated' })).toBeNull();
    view.rerender(<Notices error={false} />);
    await waitFor(() => {
      expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
        'Undo',
        'Offline',
        'Updated',
      ]);
    });
    view.unmount();
    expect(screen.queryByRole('region')).toBeNull();
  });
});

it('shows the newest notice first within a priority', async () => {
  render(
    <NotificationProvider>
      <NotificationItem>
        <div role="status">Earlier action</div>
      </NotificationItem>
      <NotificationItem>
        <div role="status">Latest action</div>
      </NotificationItem>
    </NotificationProvider>,
  );
  await waitFor(() => {
    expect(screen.getAllByRole('status').map((node) => node.textContent)).toEqual([
      'Latest action',
      'Earlier action',
    ]);
  });
});

it('retains compact ownership through notification press, focus and cancellation', async () => {
  const action = vi.fn();
  render(
    <NotificationProvider>
      <input aria-label="Search" />
      <button>Outside</button>
      <NotificationItem priority={10}>
        <div role="status">
          <button onClick={action}>Undo</button>
        </div>
      </NotificationItem>
      <NotificationItem priority={20}>
        <div role="status">Offline</div>
      </NotificationItem>
      <NotificationItem priority={30}>
        <div role="status">Updated</div>
      </NotificationItem>
    </NotificationProvider>,
  );
  await waitFor(() => {
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
  const undo = screen.getByRole('button', { name: 'Undo' });
  const outside = screen.getByRole('button', { name: 'Outside' });
  const search = screen.getByRole('textbox', { name: 'Search' });
  act(() => {
    search.focus();
  });
  await waitFor(() => {
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });
  fireEvent.pointerDown(undo);
  act(() => {
    undo.focus();
  });
  expect(screen.getAllByRole('status')).toHaveLength(1);
  fireEvent.pointerUp(undo);
  fireEvent.click(undo);
  expect(action).toHaveBeenCalledOnce();
  act(() => {
    outside.focus();
  });
  await waitFor(() => {
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
  act(() => {
    search.focus();
  });
  fireEvent.pointerDown(undo);
  act(() => {
    undo.focus();
  });
  fireEvent.pointerCancel(undo);
  act(() => {
    outside.focus();
  });
  await waitFor(() => {
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
  expect(action).toHaveBeenCalledOnce();
});
