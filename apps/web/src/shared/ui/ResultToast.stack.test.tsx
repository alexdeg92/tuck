import { act, render, screen, within, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { animationsSettled } from '../lib/animationsSettled';
import { NotificationProvider } from './NotificationStack';
import { ResultToast } from './ResultToast';

vi.mock('../lib/animationsSettled', () => ({ animationsSettled: vi.fn() }));

it('routes passive results through the shared stack and retains both lifecycle phases', async () => {
  const finish: Array<() => void> = [];
  vi.mocked(animationsSettled).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish.push(resolve);
      }),
  );
  const done = vi.fn();
  render(
    <NotificationProvider>
      <ResultToast message="Deleted review task" onDone={done} />
    </NotificationProvider>,
  );
  const region = screen.getByRole('region', { name: 'App notifications' });
  expect(await within(region).findByText('Deleted review task')).toBeVisible();
  await waitFor(() => {
    expect(finish).toHaveLength(1);
  });
  await act(async () => {
    finish[0]?.();
  });
  await waitFor(() => {
    expect(finish).toHaveLength(2);
  });
  expect(done).not.toHaveBeenCalled();
  await act(async () => {
    finish[1]?.();
  });
  expect(done).toHaveBeenCalledOnce();
});
