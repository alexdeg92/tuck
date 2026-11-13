import { z } from 'zod';
import { Instant, Task } from './tasks';

export const TrashedTask = Task.extend({ deletedAt: Instant, purgeAt: Instant });
export type TrashedTask = z.infer<typeof TrashedTask>;

export const TrashList = z.object({ items: z.array(TrashedTask) });
export type TrashList = z.infer<typeof TrashList>;
