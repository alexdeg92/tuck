import { describeUserRepository } from '../application/userRepository.contract';
import { makeMemoryUserRepository } from './memoryUserRepository';

describeUserRepository('memory', async () => makeMemoryUserRepository());
