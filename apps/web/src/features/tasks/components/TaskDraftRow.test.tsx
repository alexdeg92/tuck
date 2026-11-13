import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures, jsonResponse } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { sentBodies } from '../../../test/requests';
import { TaskDraftRow } from './TaskDraftRow';

describe('TaskDraftRow', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('opens focused on a field named New task with Medium priority', async () => {
    renderWithProviders(<TaskDraftRow onClose={vi.fn()} />);

    const title = screen.getByRole('textbox', { name: 'New task' });
    expect(title).toHaveFocus();
    expect(await screen.findByRole('button', { name: /New task priority/ })).toHaveTextContent(
      'Medium',
    );
  });

  it('chooses the priority from a custom listbox, never a native select', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<TaskDraftRow onClose={vi.fn()} />);
    expect(container.querySelector('select:not([aria-hidden="true"] *)')).toBeNull();

    await user.click(await screen.findByRole('button', { name: /New task priority/ }));
    const listbox = await screen.findByRole('listbox');
    expect(
      within(listbox)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Low', 'Medium', 'High']);
    expect(within(listbox).getByRole('option', { name: 'Medium' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.click(within(listbox).getByRole('option', { name: 'High' }));

    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.getByRole('button', { name: /New task priority/ })).toHaveTextContent('High');
  });

  it('is not a task yet: an empty or blank draft never reaches the server', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<TaskDraftRow onClose={vi.fn()} />);

    const create = screen.getByRole('button', { name: 'Create task' });
    expect(create).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'New task' }), '   ');
    expect(create).toBeDisabled();
    await user.keyboard('{Enter}');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates on Enter with the chosen priority and then closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ ...fixtures.task, title: 'Fresh task' }, 201));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /New task priority/ }));
    await user.click(await screen.findByRole('option', { name: 'High' }));
    await user.type(screen.getByRole('textbox', { name: 'New task' }), '  Fresh task {Enter}');

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(sentBodies(fetchMock, 'POST')).toEqual([
      { title: 'Fresh task', notes: '', priority: 'high', dueDate: null },
    ]);
  });

  it('creates with Medium when the priority is left alone', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(fixtures.task, 201));
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Buy milk');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(sentBodies(fetchMock, 'POST')).toEqual([
      { title: 'Buy milk', notes: '', priority: 'medium', dueDate: null },
    ]);
  });

  it('discards the draft on Escape from the title or the priority, without a request', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Never mind{Escape}');
    expect(onClose).toHaveBeenCalledTimes(1);
    (await screen.findByRole('button', { name: /New task priority/ })).focus();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('closes only the open priority menu on Escape, keeping the draft', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.click(await screen.findByRole('button', { name: /New task priority/ }));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).toBeNull();
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('discards the draft with Cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('starts from a seed title', () => {
    renderWithProviders(<TaskDraftRow initialTitle="Pick up film" onClose={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveValue('Pick up film');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeEnabled();
  });

  it('keeps the draft and says why when the server refuses it', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(fixtures.errorValidation, 400)));
    renderWithProviders(<TaskDraftRow onClose={onClose} />);

    await user.type(screen.getByRole('textbox', { name: 'New task' }), 'Broken{Enter}');

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'New task' })).toHaveValue('Broken');
  });
});
