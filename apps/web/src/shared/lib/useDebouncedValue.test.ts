import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDebouncedValue } from './useDebouncedValue';

describe('useDebouncedValue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('updates after the delay', async () => {
    const { result, rerender } = renderHook(
      ({ value }: { value: string }) => useDebouncedValue(value, 250),
      { initialProps: { value: 'a' } },
    );

    expect(result.current).toBe('a');
    rerender({ value: 'ab' });
    expect(result.current).toBe('a');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(result.current).toBe('ab');
  });
});
