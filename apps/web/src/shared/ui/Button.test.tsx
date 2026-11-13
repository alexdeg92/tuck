import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from './Button';

describe('Button', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sets a brief data-released peak on primary pointer up', () => {
    vi.useFakeTimers();
    render(<Button variant="primary">Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });

    fireEvent.pointerUp(button);
    expect(button).toHaveAttribute('data-released', 'true');

    vi.advanceTimersByTime(180);
    expect(button).not.toHaveAttribute('data-released');
  });

  it('does not release-pulse secondary or disabled buttons', () => {
    render(
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="primary" disabled>
          Busy
        </Button>
      </>,
    );

    fireEvent.pointerUp(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.pointerUp(screen.getByRole('button', { name: 'Busy' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).not.toHaveAttribute('data-released');
    expect(screen.getByRole('button', { name: 'Busy' })).not.toHaveAttribute('data-released');
  });
});
