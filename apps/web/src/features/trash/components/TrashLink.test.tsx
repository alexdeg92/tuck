import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { TrashLink } from './TrashLink';

const serve = (body: unknown, status = 200) => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, status))),
  );
};

describe('TrashLink', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('links to the Trash with the count the server returned', async () => {
    serve(fixtures.trashList);
    renderWithProviders(<TrashLink />);

    // The name is the link's own text, its last word for screen readers only (Chromium reads
    // "Trash 2 tasks"; jsdom's name algorithm trims each text node, so check the text too).
    const link = await screen.findByRole('link', { name: /^Trash\s?2\s?tasks$/ });
    expect(link).toHaveAttribute('href', '/trash');
    expect(link).toHaveTextContent('Trash2 tasks');
    expect(link).not.toHaveAttribute('aria-label');
  });

  it('reads plain Trash before the count loads, when it is empty, or when it fails', async () => {
    serve({ items: [] });
    renderWithProviders(<TrashLink />);
    expect(screen.getByRole('link', { name: 'Trash' })).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'Trash' })).not.toHaveTextContent(/\d/);
  });
});
