import { endpoints } from '@todo/contracts';
import { Router } from 'express';
import { route } from '../../../shared/http/route';
import { sessionUser } from '../../../shared/http/session';
import type {
  makeCreateTask,
  makeDeleteForever,
  makeEmptyTrash,
  makeGetTask,
  makeListTasks,
  makeListTrash,
  makeMoveTask,
  makeRestoreTask,
  makeTrashTask,
  makeUpdateTask,
} from '../application';

type Deps = {
  listTasks: ReturnType<typeof makeListTasks>;
  createTask: ReturnType<typeof makeCreateTask>;
  getTask: ReturnType<typeof makeGetTask>;
  updateTask: ReturnType<typeof makeUpdateTask>;
  moveTask: ReturnType<typeof makeMoveTask>;
  trashTask: ReturnType<typeof makeTrashTask>;
  listTrash: ReturnType<typeof makeListTrash>;
  restoreTask: ReturnType<typeof makeRestoreTask>;
  deleteForever: ReturnType<typeof makeDeleteForever>;
  emptyTrash: ReturnType<typeof makeEmptyTrash>;
};

export const tasksRouter = (useCases: Deps): Router => {
  const router = Router();
  route(router, endpoints.listTasks, ({ query }, res) =>
    useCases.listTasks(sessionUser(res).id, query),
  );
  route(router, endpoints.createTask, ({ body }, res) =>
    useCases.createTask(sessionUser(res).id, body),
  );
  route(router, endpoints.getTask, ({ params }, res) =>
    useCases.getTask(sessionUser(res).id, params.id),
  );
  route(router, endpoints.updateTask, ({ params, body }, res) =>
    useCases.updateTask(sessionUser(res).id, params.id, body),
  );
  route(router, endpoints.deleteTask, ({ params }, res) =>
    useCases.trashTask(sessionUser(res).id, params.id),
  );
  route(router, endpoints.listTrash, (_request, res) => useCases.listTrash(sessionUser(res).id));
  route(router, endpoints.restoreTask, ({ params }, res) =>
    useCases.restoreTask(sessionUser(res).id, params.id),
  );
  route(router, endpoints.deleteForever, ({ params }, res) =>
    useCases.deleteForever(sessionUser(res).id, params.id),
  );
  route(router, endpoints.emptyTrash, (_request, res) => useCases.emptyTrash(sessionUser(res).id));
  route(router, endpoints.moveTask, ({ params, body }, res) =>
    useCases.moveTask(sessionUser(res).id, params.id, body),
  );
  return router;
};
