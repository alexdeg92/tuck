import { endpoints } from '@todo/contracts';
import { Router } from 'express';
import { route } from './route';

export const healthRouter = (version: string): Router =>
  route(Router(), endpoints.health, async () => ({ status: 'ok' as const, version }));
