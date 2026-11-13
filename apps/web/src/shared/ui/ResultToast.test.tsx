import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultToast } from './ResultToast';

describe('ResultToast', () => {
  it('says the result politely, then leaves and reports it is done', async () => {
    const onDone = vi.fn();
    render(<ResultToast message="Deleted “Pay rent”" onDone={onDone} />);
    expect(screen.getByRole('status')).toHaveTextContent('Deleted “Pay rent”');

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Deleted “Pay rent”').closest('[data-phase]')).toHaveAttribute(
      'data-phase',
      'leaving',
    );
  });
});
