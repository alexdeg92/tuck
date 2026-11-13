import type { Query, QueryClient } from '@tanstack/react-query';
import type { User } from '@todo/contracts';
import { sessionKeys } from './keys';

const isPrivate = (query: Query) => query.queryKey[0] !== sessionKeys.all[0];

export async function setIdentity(queryClient: QueryClient, user: User | null): Promise<void> {
  await queryClient.cancelQueries({ predicate: isPrivate });
  queryClient.removeQueries({ predicate: isPrivate });
  queryClient.getMutationCache().clear();
  queryClient.setQueryData(sessionKeys.me(), user);
}
