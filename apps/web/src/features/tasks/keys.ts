export const taskKeys = {
  all: ['tasks'] as const,
  create: () => [...taskKeys.all, 'create'] as const,
  remove: () => [...taskKeys.all, 'remove'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (q: string) => [...taskKeys.lists(), { q }] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
};
