import { endpoints, type Health } from '@todo/contracts';
import { call } from './http';

export function fetchHealth(): Promise<Health> {
  return call(endpoints.health, {});
}
