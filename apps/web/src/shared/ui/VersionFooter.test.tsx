import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../test/fixtures';
import { renderWithProviders } from '../../test/query';
import { VersionFooter } from './VersionFooter';

describe('VersionFooter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the health version', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.health)));
    renderWithProviders(<VersionFooter />);
    expect(await screen.findByText(`Tuck v${fixtures.health.version}`)).toBeInTheDocument();
  });
});
