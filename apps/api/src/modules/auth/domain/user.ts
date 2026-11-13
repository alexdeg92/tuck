import { User } from '@todo/contracts';
import { z } from 'zod';

export const UserAccount = User.extend({
  passwordHash: z.string().min(1),
  createdAt: z.iso.datetime(),
  /** Bumped by "sign out everywhere"; a token carrying an older version is refused. */
  sessionVersion: z.number().int().nonnegative(),
});
export type UserAccount = z.infer<typeof UserAccount>;

export const toUser = ({ id, email }: UserAccount): User => ({ id, email });
