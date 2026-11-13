import { Task } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { fixtures } from '../../test/fixtures';
import { splitByStatus } from './groups';

const base = Task.parse(fixtures.task);
const make = (id: number, status: 'todo' | 'done'): Task => ({
  ...base,
  id: `00000000-0000-4000-8000-00000000000${String(id)}`,
  title: `Task ${String(id)}`,
  status,
});

describe('splitByStatus', () => {
  it('lists open tasks then done tasks, each in the server order', () => {
    const items = [make(1, 'done'), make(2, 'todo'), make(3, 'done'), make(4, 'todo')];
    const { open, done } = splitByStatus(items);
    expect(open.map((task) => task.title)).toEqual(['Task 2', 'Task 4']);
    expect(done.map((task) => task.title)).toEqual(['Task 1', 'Task 3']);
  });

  it('never sorts: ids, titles and dates do not change the order', () => {
    const items = [make(9, 'done'), make(1, 'done')];
    expect(splitByStatus(items).done.map((task) => task.title)).toEqual(['Task 9', 'Task 1']);
  });

  it('returns empty groups for an empty list', () => {
    expect(splitByStatus([])).toEqual({ open: [], done: [] });
  });
});
