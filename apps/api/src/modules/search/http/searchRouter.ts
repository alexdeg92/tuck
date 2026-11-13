import { endpoints } from '@todo/contracts';
import { Router } from 'express';
import { route } from '../../../shared/http/route';
import { sessionUser } from '../../../shared/http/session';
import type { makeRelatedTasks, makeSearchTasks, makeTaskHighlights } from '../application';

type Deps = {
  searchTasks: ReturnType<typeof makeSearchTasks>;
  relatedTasks: ReturnType<typeof makeRelatedTasks>;
  taskHighlights: ReturnType<typeof makeTaskHighlights>;
};

export const searchRouter = (useCases: Deps): Router => {
  const router = Router();
  route(router, endpoints.search, ({ query }, res) =>
    useCases.searchTasks(sessionUser(res).id, query),
  );
  route(router, endpoints.relatedTasks, ({ params }, res) =>
    useCases.relatedTasks(sessionUser(res).id, params.id),
  );
  route(router, endpoints.taskHighlights, ({ params, query }, res) =>
    useCases.taskHighlights(sessionUser(res).id, params.id, query),
  );
  return router;
};
