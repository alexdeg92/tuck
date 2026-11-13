import { endpoints } from '@todo/contracts';
import { Router } from 'express';
import { route } from '../../../shared/http/route';
import { sessionUser } from '../../../shared/http/session';
import type {
  makeAddChecklistItem,
  makeDeleteChecklistItem,
  makeListChecklist,
  makeMoveChecklistItem,
  makeUpdateChecklistItem,
} from '../application';

type Deps = {
  listChecklist: ReturnType<typeof makeListChecklist>;
  addChecklistItem: ReturnType<typeof makeAddChecklistItem>;
  updateChecklistItem: ReturnType<typeof makeUpdateChecklistItem>;
  deleteChecklistItem: ReturnType<typeof makeDeleteChecklistItem>;
  moveChecklistItem: ReturnType<typeof makeMoveChecklistItem>;
};

export const checklistsRouter = (useCases: Deps): Router => {
  const router = Router();
  route(router, endpoints.listChecklist, ({ params }, res) =>
    useCases.listChecklist(sessionUser(res).id, params.id),
  );
  route(router, endpoints.addChecklistItem, ({ params, body }, res) =>
    useCases.addChecklistItem(sessionUser(res).id, params.id, body),
  );
  route(router, endpoints.updateChecklistItem, ({ params, body }, res) =>
    useCases.updateChecklistItem(sessionUser(res).id, params.id, params.itemId, body),
  );
  route(router, endpoints.deleteChecklistItem, ({ params }, res) =>
    useCases.deleteChecklistItem(sessionUser(res).id, params.id, params.itemId),
  );
  route(router, endpoints.moveChecklistItem, ({ params, body }, res) =>
    useCases.moveChecklistItem(sessionUser(res).id, params.id, params.itemId, body),
  );
  return router;
};
