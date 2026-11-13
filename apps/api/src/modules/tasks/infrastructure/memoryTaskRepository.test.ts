import { describeTrashRepository } from '../application/trashRepository.contract';
import {
  describeTaskRepository,
  type RepositoryHarness,
} from '../application/taskRepository.contract';
import { makeMemoryTaskRepository } from './memoryTaskRepository';

const harness = async (): Promise<RepositoryHarness> => ({
  tasks: makeMemoryTaskRepository(),
  createUser: async () => crypto.randomUUID(),
});

describeTaskRepository('memory', harness);
describeTrashRepository('memory', harness);
