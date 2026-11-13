import { describe, expect, it } from 'vitest';
import {
  ChecklistItem,
  CreateChecklistItemInput,
  MoveChecklistItemInput,
  UpdateChecklistItemInput,
} from './checklist';

const item = {
  id: '6a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
  taskId: '3f2b8c1e-7a4d-4e9b-9c2a-1d5e6f7a8b9c',
  text: 'Oat milk',
  notes: '',
  done: false,
  position: 'a0',
  createdAt: '2026-11-11T09:31:00.000Z',
  updatedAt: '2026-11-11T09:31:00.000Z',
};

describe('ChecklistItem', () => {
  it('accepts a valid item', () => {
    expect(ChecklistItem.parse(item)).toEqual(item);
  });

  it('rejects notes over 1000 characters', () => {
    expect(ChecklistItem.safeParse({ ...item, notes: 'x'.repeat(1001) }).success).toBe(false);
  });
});

describe('CreateChecklistItemInput', () => {
  it('trims the text and defaults the notes', () => {
    expect(CreateChecklistItemInput.parse({ text: '  Eggs  ' })).toEqual({
      text: 'Eggs',
      notes: '',
    });
  });

  it.each([
    ['an empty text', { text: '   ' }],
    ['a 201-character text', { text: 'x'.repeat(201) }],
    ['a client-chosen done flag', { text: 'Eggs', done: true }],
    ['a client-chosen position', { text: 'Eggs', position: 'a0' }],
  ])('rejects %s', (_label, input) => {
    expect(CreateChecklistItemInput.safeParse(input).success).toBe(false);
  });
});

describe('UpdateChecklistItemInput', () => {
  it('accepts any one field', () => {
    expect(UpdateChecklistItemInput.parse({ done: true })).toEqual({ done: true });
    expect(UpdateChecklistItemInput.parse({ text: ' Milk ' })).toEqual({ text: 'Milk' });
  });

  it('requires at least one field and rejects unknown ones', () => {
    expect(UpdateChecklistItemInput.safeParse({}).success).toBe(false);
    expect(UpdateChecklistItemInput.safeParse({ taskId: item.taskId }).success).toBe(false);
  });
});

describe('MoveChecklistItemInput', () => {
  it('accepts null (move to the top) or an item id', () => {
    expect(MoveChecklistItemInput.parse({ afterId: null })).toEqual({ afterId: null });
    expect(MoveChecklistItemInput.safeParse({ afterId: 'nope' }).success).toBe(false);
  });
});
