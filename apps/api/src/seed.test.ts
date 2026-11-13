import { CreateTaskInput } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { DEMO_TASKS, FIRST_SEED_KEYS } from './demoContent';
import { describeSeed } from './seed.contract';
import { openStorage } from './storage';

describeSeed('sqlite', () => openStorage({ databaseUrl: undefined, databaseFile: ':memory:' }));

describe('demo content', () => {
  const notes = DEMO_TASKS.map(({ notes }) => notes);
  const count = (text: string, word: string) => text.toLowerCase().split(word).length - 1;

  it('is valid task input with unique keys, keeping the first seed', () => {
    DEMO_TASKS.forEach(({ title, notes: text, priority }) => {
      expect(CreateTaskInput.safeParse({ title, notes: text, priority }).success, title).toBe(true);
    });
    expect(new Set(DEMO_TASKS.map(({ key }) => key)).size).toBe(DEMO_TASKS.length);
    expect(DEMO_TASKS.filter(({ key }) => FIRST_SEED_KEYS.includes(key))).toHaveLength(6);
    expect(DEMO_TASKS.length).toBeGreaterThanOrEqual(28);
  });

  it('has long notes to read, some over 4500 characters', () => {
    expect(notes.filter(({ length }) => length >= 800).length).toBeGreaterThanOrEqual(12);
    expect(notes.filter(({ length }) => length >= 4500).length).toBeGreaterThanOrEqual(2);
  });

  it('repeats a word in one note and across tasks, with accents and mixed case', () => {
    expect(Math.max(...notes.map((text) => count(text, 'budget')))).toBeGreaterThanOrEqual(5);
    expect(
      DEMO_TASKS.filter((task) => count(`${task.title} ${task.notes}`, 'budget') > 0).length,
    ).toBeGreaterThanOrEqual(3);
    const all = DEMO_TASKS.map((task) => `${task.title} ${task.notes}`).join(' ');
    expect(all).toContain('café');
    expect(all).toContain('résumé');
    expect(all).toMatch(/BUDGET|Budget/);
  });

  it('varies priorities, due dates, completion and checklists', () => {
    expect(new Set(DEMO_TASKS.map(({ priority }) => priority))).toEqual(
      new Set(['low', 'medium', 'high']),
    );
    expect(DEMO_TASKS.some(({ dueInDays }) => dueInDays === null)).toBe(true);
    expect(DEMO_TASKS.some(({ dueInDays }) => dueInDays !== null && dueInDays < 0)).toBe(true);
    expect(DEMO_TASKS.filter(({ done }) => done === true).length).toBeGreaterThanOrEqual(3);
    expect(
      DEMO_TASKS.filter(({ checklist }) => checklist.length > 0).length,
    ).toBeGreaterThanOrEqual(5);
  });
});
