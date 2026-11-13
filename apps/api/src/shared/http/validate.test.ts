import { CreateTaskInput } from '@todo/contracts';
import { describe, expect, it } from 'vitest';
import { parseInput } from './validate';

describe('parseInput', () => {
  it('returns the parsed value', () => {
    expect(parseInput(CreateTaskInput, { title: ' Buy milk ' })).toMatchObject({
      title: 'Buy milk',
    });
  });

  it('throws VALIDATION_FAILED with one detail per invalid field', () => {
    expect(() => parseInput(CreateTaskInput, { title: '', priority: 'urgent' })).toThrow(
      expect.objectContaining({
        code: 'VALIDATION_FAILED',
        details: [
          expect.objectContaining({ path: 'title' }),
          expect.objectContaining({ path: 'priority' }),
        ],
      }),
    );
  });
});
