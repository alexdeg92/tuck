import type { TaskId } from '@todo/contracts';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useMatch } from 'react-router';

type OpenTaskStore = {
  get: () => string | undefined;
  set: (id: string | undefined) => void;
  subscribe: (listener: () => void) => () => void;
};

function createOpenTaskStore(): OpenTaskStore {
  let openId: string | undefined;
  const listeners = new Set<() => void>();
  return {
    get: () => openId,
    set: (id) => {
      if (id === openId) return;
      openId = id;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const OpenTaskContext = createContext<OpenTaskStore | null>(null);

const noStore = {
  get: () => undefined,
  subscribe: () => () => undefined,
};

function OpenTaskRoute({ store }: { store: OpenTaskStore }) {
  const openId = useMatch('/tasks/:id')?.params.id;

  useLayoutEffect(() => {
    store.set(openId);
  }, [store, openId]);
  return null;
}

export function OpenTaskProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createOpenTaskStore);
  return (
    <OpenTaskContext value={store}>
      <OpenTaskRoute store={store} />
      {children}
    </OpenTaskContext>
  );
}

export function useIsOpenTask(id: TaskId): boolean {
  const store = useContext(OpenTaskContext) ?? noStore;
  return useSyncExternalStore(store.subscribe, () => store.get() === id);
}
