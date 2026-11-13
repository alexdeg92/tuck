import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SearchNotice } from './SearchNotice';

describe('SearchNotice', () => {
  it('underlines the corrected words of the suggestion and applies the whole suggestion', async () => {
    const user = userEvent.setup();
    const onApply = vi.fn();
    render(
      <SearchNotice
        mode="fuzzy"
        truncated={false}
        suggestion={{ text: 'oat milk', changed: [{ start: 4, end: 8, typed: 'mlik' }] }}
        onApply={onApply}
      />,
    );

    const button = screen.getByRole('button', { name: 'oat milk' });
    expect(button.querySelector('[data-changed]')).toHaveTextContent(/^milk$/);
    expect(button.querySelectorAll('[data-changed]')).toHaveLength(1);
    await user.click(button);
    expect(onApply).toHaveBeenCalledWith('oat milk');
  });

  it('says it shows close matches, and nothing in exact mode', () => {
    const { rerender } = render(
      <SearchNotice mode="fuzzy" truncated={false} suggestion={null} onApply={vi.fn()} />,
    );
    expect(screen.getByText('Showing close matches')).toBeInTheDocument();
    rerender(<SearchNotice mode="exact" truncated={false} suggestion={null} onApply={vi.fn()} />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
