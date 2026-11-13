import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SearchBar } from './SearchBar';

function Controlled({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <SearchBar value={value} onChange={setValue} />;
}

describe('SearchBar', () => {
  it('exposes the Search tasks searchbox', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} />);
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });
    await user.type(box, 'q');
    expect(onChange).toHaveBeenCalled();
  });

  it('is the flush field and shows a clear button only for a non-empty query', async () => {
    const user = userEvent.setup();
    render(<Controlled />);

    const form = screen.getByRole('search');
    expect(form).toHaveClass('searchNew');
    expect(form).toHaveAttribute('data-has-value', 'false');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), 'milk');
    expect(form).toHaveAttribute('data-has-value', 'true');
    expect(screen.getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });

  it('clears on the button and keeps the focus in the field', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="milk" />);
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });

    await user.click(screen.getByRole('button', { name: 'Clear search' }));

    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
  });

  it('clears on Escape and keeps the focus', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="milk" />);
    const box = screen.getByRole('searchbox', { name: 'Search tasks' });
    box.focus();

    await user.keyboard('{Escape}');

    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
  });

  it('does not submit the page when Enter is pressed', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="milk" />);
    await user.type(screen.getByRole('searchbox', { name: 'Search tasks' }), '{Enter}');
    expect(screen.getByRole('searchbox', { name: 'Search tasks' })).toHaveValue('milk');
  });
});
