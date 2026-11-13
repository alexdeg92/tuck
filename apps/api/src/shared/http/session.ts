import type { User } from '@todo/contracts';
import type { Response } from 'express';
import { unauthenticated } from '../errors';

declare module 'express-serve-static-core' {
  // Module augmentation merges into Express's interface; a type alias cannot.
  // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
  interface Locals {
    user?: User;
  }
}

export const sessionUser = (res: Response): User => {
  const { user } = res.locals;
  if (!user) throw unauthenticated();
  return user;
};
