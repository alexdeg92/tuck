export const searchKeys = {
  results: (q: string) => ['tasks', 'search', 'results', { q }] as const,
  highlights: (id: string, q: string, taskUpdatedAt: string) =>
    ['search', 'highlights', id, { q, taskUpdatedAt }] as const,
  checklist: (id: string) => ['search', 'checklist', id] as const,
};

export const taskMutationKey = ['tasks'] as const;
