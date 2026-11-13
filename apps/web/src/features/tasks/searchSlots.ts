import type { Task } from '@todo/contracts';
import type { ReactNode } from 'react';

export type RowExtras = { title: ReactNode; details: ReactNode; meta: ReactNode };

export type SearchResults = {
  status: 'pending' | 'error' | 'success';
  tasks: Task[];
  error: string | null;
  retry: () => void;
  extras: (task: Task) => RowExtras | undefined;
};

export type ListSearch = {
  input: string;
  setInput: (value: string) => void;

  q: string;
  bar: ReactNode;
  notice: ReactNode;
  results: SearchResults | null;
};

export type NotesSlots = {
  finder?: ReactNode;
  reading?: ReactNode;
  onSaved?: () => void;
};

export type NotesSearch = (props: {
  task: Task | undefined;
  q: string;
  children: (slots: NotesSlots) => ReactNode;
}) => ReactNode;
