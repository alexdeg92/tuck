import { Task } from '@todo/contracts';
import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNoteSaver, discardPendingSaves } from '../features/tasks/autosave';
import { flushPendingSaves } from '../shared/pwa/update';
import { fixtures } from '../test/fixtures';
import { Providers } from './providers';

const task = Task.parse(fixtures.task);

describe('the release reload waits for note autosave', () => {
  afterEach(() => {
    discardPendingSaves();
  });

  it('sends pending note saves before a reload, and resolves once they are saved', async () => {
    render(<Providers>{null}</Providers>);
    const send = vi.fn(async () => ({
      ...task,
      notes: 'typed',
      updatedAt: '2026-11-11T10:00:00.000Z',
    }));
    const saver = createNoteSaver({ task, send, onSaved: vi.fn() });
    const release = saver.register();
    saver.edit({ notes: 'typed' });

    await expect(flushPendingSaves()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(1);
    release();
  });

  it('refuses the reload while note text could not be saved', async () => {
    render(<Providers>{null}</Providers>);
    const saver = createNoteSaver({
      task,
      send: () => Promise.reject(new TypeError('Failed to fetch')),
      onSaved: vi.fn(),
    });
    const release = saver.register();
    saver.edit({ notes: 'typed' });

    await expect(flushPendingSaves()).rejects.toThrow();
    release();
  });
});
