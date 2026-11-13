import { describeDemoContentLedger } from '../application/demoContentLedger.contract';
import { makeMemoryDemoContentLedger } from './memoryDemoContentLedger';

describeDemoContentLedger('memory', async () => ({
  ledger: makeMemoryDemoContentLedger(),
  createUser: async () => crypto.randomUUID(),
}));
