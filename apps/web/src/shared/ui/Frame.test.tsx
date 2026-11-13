import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import layouts from '../../styles/layouts.module.css';
import { renderWithProviders } from '../../test/query';
import { AppBar, AppShell, FrameBar, FrameBody, FrameHead, Pane, Workspace } from './Frame';
import { EmptyState, ErrorState, SkeletonList } from './States';
import { VersionFooter } from './VersionFooter';

const cls = (...names: (string | undefined)[]): string[] => names.map((name) => name ?? 'missing');

describe('Frame', () => {
  it('maps the shell, panes and rows onto the layout classes', () => {
    render(
      <MemoryRouter>
        <AppShell>
          <AppBar>account</AppBar>
          <Workspace detailOpen={false}>
            <Pane pane="master" label="Task list">
              <FrameHead>head</FrameHead>
              <FrameBar>bar</FrameBar>
              <FrameBody>body</FrameBody>
            </Pane>
            <Pane pane="detail" label="Task notes">
              <FrameBody>notes</FrameBody>
            </Pane>
          </Workspace>
        </AppShell>
      </MemoryRouter>,
    );

    const master = screen.getByRole('region', { name: 'Task list' });
    const detail = screen.getByRole('region', { name: 'Task notes' });
    expect(master).toHaveClass(...cls(layouts.frame, layouts.master));
    expect(detail).toHaveClass(...cls(layouts.frame, layouts.detail));
    expect(screen.getByRole('main')).toHaveClass(...cls(layouts.workspace));
    expect(screen.getByRole('main').parentElement).toHaveClass(...cls(layouts.app));
    expect(within(master).getByRole('toolbar', { name: 'Task tools' })).toHaveTextContent('bar');
    expect(within(master).getByText('body')).toHaveClass(...cls(layouts.body));
    expect(within(master).getByText('head')).toHaveClass(...cls(layouts.head));
  });

  it('keeps one main landmark, however many panes have a scrolling body', () => {
    render(
      <MemoryRouter>
        <Workspace detailOpen>
          <Pane pane="master" label="Task list">
            <FrameBody>list</FrameBody>
          </Pane>
          <Pane pane="detail" label="Task notes">
            <FrameBody>notes</FrameBody>
          </Pane>
        </Workspace>
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('tells the layout which pane is open through data-detail-open', () => {
    const { rerender } = render(
      <Workspace detailOpen={false}>
        <span>pane</span>
      </Workspace>,
    );
    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'false');
    rerender(
      <Workspace detailOpen>
        <span>pane</span>
      </Workspace>,
    );
    expect(screen.getByRole('main')).toHaveAttribute('data-detail-open', 'true');
  });
});

describe('VersionFooter', () => {
  it('is the last row of the window and shows a placeholder before the version arrives', () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => new Promise<Response>(() => undefined);
    try {
      renderWithProviders(<VersionFooter />);
      expect(screen.getByRole('contentinfo')).toHaveTextContent('Tuck v…');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('states', () => {
  it('renders empty, error and skeletons', () => {
    const { rerender } = render(<EmptyState title="None" description="Add one" />);
    expect(screen.getByText('None')).toBeInTheDocument();
    rerender(<ErrorState message="Boom" onRetry={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    rerender(<SkeletonList rows={2} />);
    expect(document.querySelectorAll('[aria-hidden="true"] > div')).toHaveLength(2);
  });
});
