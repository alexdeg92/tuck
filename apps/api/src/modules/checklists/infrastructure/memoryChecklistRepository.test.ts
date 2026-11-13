import { makeMemoryStore } from '../../../shared/db/memoryStore';
import {
  type ChecklistHarness,
  describeChecklistRepository,
} from '../application/checklistRepository.contract';
import { makeMemoryTaskRepository } from '../../tasks/infrastructure/memoryTaskRepository';
import { makeMemoryChecklistRepository } from './memoryChecklistRepository';

const harness = async (): Promise<ChecklistHarness> => {
  const store = makeMemoryStore();
  return {
    tasks: makeMemoryTaskRepository(store),
    checklists: makeMemoryChecklistRepository(store),
    createUser: async () => crypto.randomUUID(),
  };
};

describeChecklistRepository('memory', harness);
