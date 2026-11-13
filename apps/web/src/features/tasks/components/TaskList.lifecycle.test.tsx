import { Task } from '@todo/contracts';
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fixtures } from '../../../test/fixtures';
import { renderWithProviders } from '../../../test/query';
import { TaskList } from './TaskList';

/*
 * Animation endings arrive out of order: an old row's animation can settle after a replacement
 * row has taken its place (an Undo, a failed delete restored, then the same action again). Each
 * phase must end on its own element's animations only.
 */

type Pending = { element: Element; phase: string; resolve: () => void };
const pending: Pending[] = [];

vi.mock('../../../shared/lib/animationsSettled', () => ({
  animationsSettled: (element: Element) =>
    new Promise<void>((resolve) => {
      pending.push({ element, phase: element.getAttribute('data-phase') ?? '', resolve });
    }),
}));

afterEach(() => {
  pending.splice(0);
});

const base = Task.parse(fixtures.task);
const make = (n: number, status: 'todo' | 'done' = 'todo'): Task => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${String(n)}`,
  title: `Task ${String(n)}`,
  status,
});
const idleDeletion = { send: vi.fn(), pending: false };
const [a, b] = [make(1), make(2)];
const doneA = { ...a, status: 'done' as const };

const settleFirst = async (phase: string) => {
  const entry = pending.find((candidate) => candidate.phase === phase);
  if (entry === undefined) throw new Error(`no watcher for ${phase}`);
  pending.splice(pending.indexOf(entry), 1);
  await act(async () => {
    entry.resolve();
    await Promise.resolve();
  });
};

const ghostPhase = () =>
  document.querySelector(`[data-presence="${a.id}:open"]`)?.getAttribute('data-phase') ?? null;

describe('row phases under out-of-order animation endings', () => {
  it('a late end from a deleted row never removes the ghost of the same row deleted again', async () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[a, b]} q="" />,
    );

    rerender(<TaskList deletion={idleDeletion} tasks={[b]} q="" />);
    rerender(<TaskList deletion={idleDeletion} tasks={[a, b]} q="" />);
    rerender(<TaskList deletion={idleDeletion} tasks={[b]} q="" />);
    expect(ghostPhase()).toBe('leaving');

    await settleFirst('leaving');
    expect(ghostPhase()).toBe('leaving');

    const own = pending.filter((entry) => entry.phase === 'leaving' && entry.element.isConnected);
    expect(own).toHaveLength(1);
    await settleFirst('leaving');
    expect(ghostPhase()).toBeNull();
  });

  it('a late end from a first completion never advances the ghost of the completion after Undo', async () => {
    const { rerender } = renderWithProviders(
      <TaskList deletion={idleDeletion} tasks={[a, b]} q="" />,
    );

    rerender(<TaskList deletion={idleDeletion} tasks={[b, doneA]} q="" />);
    rerender(<TaskList deletion={idleDeletion} tasks={[a, b]} q="" />);
    rerender(<TaskList deletion={idleDeletion} tasks={[b, doneA]} q="" />);
    expect(ghostPhase()).toBe('completing');

    await settleFirst('completing');
    expect(ghostPhase()).toBe('completing');

    await settleFirst('completing');
    expect(ghostPhase()).toBe('leaving');
  });
});
