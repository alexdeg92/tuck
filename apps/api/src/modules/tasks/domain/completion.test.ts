import { describe, expect, it } from 'vitest';
import { completedAtAfter } from './completion';

const NOW = '2026-11-12T10:00:00.000Z';
const EARLIER = '2026-11-11T09:00:00.000Z';

describe('completedAtAfter', () => {
  it.each([
    ['an open task is completed', { status: 'todo', completedAt: null }, 'done', NOW],
    ['a done task stays done', { status: 'done', completedAt: EARLIER }, 'done', EARLIER],
    ['a done task is reopened', { status: 'done', completedAt: EARLIER }, 'todo', null],
    ['an open task stays open', { status: 'todo', completedAt: null }, 'todo', null],
  ] as const)('%s', (_label, task, status, expected) => {
    expect(completedAtAfter(task, status, NOW)).toBe(expected);
  });
});
