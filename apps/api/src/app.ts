import { endpoints, ListTasksQuery } from '@todo/contracts';
import cookieParser from 'cookie-parser';
import express, { type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import {
  makeAuthenticate,
  makeLogIn,
  makeLogOutEverywhere,
  makeSignUp,
  type PasswordHasher,
  type TokenIssuer,
  type UserRepository,
} from './modules/auth/application';
import { authRouter, makeRequireAuth } from './modules/auth/http';
import {
  type ChecklistRepository,
  makeAddChecklistItem,
  makeDeleteChecklistItem,
  makeItemsOfUser,
  makeListChecklist,
  makeMoveChecklistItem,
  makeUpdateChecklistItem,
} from './modules/checklists/application';
import { checklistsRouter } from './modules/checklists/http';
import {
  makeRelatedTasks,
  makeSearchTasks,
  makeTaskHighlights,
} from './modules/search/application';
import { searchRouter } from './modules/search/http';
import {
  type KeyBetween,
  makeCreateTask,
  makeDeleteForever,
  makeEmptyTrash,
  makeGetTask,
  makeListTrash,
  makeListTasks,
  makeMoveTask,
  makeRestoreTask,
  makeTasksOfUser,
  makeTrashTask,
  makeUpdateTask,
  type TaskRepository,
} from './modules/tasks/application';
import { tasksRouter } from './modules/tasks/http';
import { makeErrorHandler, routeNotFound } from './shared/http/errors';
import { healthRouter } from './shared/http/healthRouter';
import { jsonOnly } from './shared/http/jsonOnly';
import {
  makeRateLimit,
  type RateLimitOptions,
  type RateLimitStoreFactory,
} from './shared/http/rateLimit';
import { sessionUser } from './shared/http/session';

export type AppDeps = {
  version: string;
  users: UserRepository;
  tasks: TaskRepository;
  checklists: ChecklistRepository;
  hasher: PasswordHasher;
  tokens: TokenIssuer;
  clock: () => Date;
  ids: () => string;
  keyBetween: KeyBetween;
  cookieSecure: boolean;
  /** Only explicitly insecure HTTP deployments disable Helmet HSTS. */
  hsts?: false;

  trustProxy: number;

  authRateLimit: RateLimitOptions;

  searchRateLimit: RateLimitOptions;
  /** Shared counters (Redis) for several API instances; unset, each process counts in memory. */
  rateLimitStore?: RateLimitStoreFactory;
  logError: (error: unknown) => void;
};

const TASK_BODY_LIMIT = '640kb';
const smallBodies = express.json({ limit: '16kb' });
const taskBodies = express.json({ limit: TASK_BODY_LIMIT });

const isTaskWrite = ({ method, path }: { method: string; path: string }): boolean =>
  (method === 'POST' && /^\/api\/tasks\/?$/.test(path)) ||
  (method === 'PATCH' && /^\/api\/tasks\/[^/]+\/?$/.test(path));

export const buildApp = (deps: AppDeps): Express => {
  const requireAuth = makeRequireAuth({
    authenticate: makeAuthenticate(deps),
    clock: deps.clock,
    cookieSecure: deps.cookieSecure,
  });

  const sources = { tasksOf: makeTasksOfUser(deps), itemsOf: makeItemsOfUser(deps) };

  const searchLimit = makeRateLimit(deps.searchRateLimit, {
    key: (_req, res) => sessionUser(res).id,
    ...(deps.rateLimitStore && { store: deps.rateLimitStore('search') }),
  });
  const searchingListOnly: RequestHandler = (req, res, next) => {
    const query = ListTasksQuery.safeParse(req.query);
    if (query.success && query.data.q !== '') searchLimit(req, res, next);
    else next();
  };

  return express()
    .disable('x-powered-by')
    .set('trust proxy', deps.trustProxy)
    .use(helmet({ ...(deps.hsts === false && { strictTransportSecurity: false }) }))
    .use(jsonOnly)

    .use((req, res, next) => {
      if (isTaskWrite(req)) next();
      else smallBodies(req, res, next);
    })
    .use(cookieParser())
    .use(healthRouter(deps.version))
    .use(
      authRouter({
        signUp: makeSignUp(deps),
        logIn: makeLogIn(deps),
        logOutEverywhere: makeLogOutEverywhere(deps),
        requireAuth,
        rateLimit: makeRateLimit(
          deps.authRateLimit,
          deps.rateLimitStore && { store: deps.rateLimitStore('auth') },
        ),
        clock: deps.clock,
        cookieSecure: deps.cookieSecure,
      }),
    )

    .use(endpoints.listTasks.path, requireAuth)
    .post(endpoints.createTask.path, taskBodies)
    .patch(endpoints.updateTask.path, taskBodies)

    .use(endpoints.listTrash.path, requireAuth)
    .use(endpoints.search.path, requireAuth, searchLimit)

    .get(endpoints.listTasks.path, searchingListOnly)

    .get(endpoints.taskHighlights.path, searchLimit)
    .use(
      tasksRouter({
        listTasks: makeListTasks(deps),
        createTask: makeCreateTask(deps),
        getTask: makeGetTask(deps),
        updateTask: makeUpdateTask(deps),
        moveTask: makeMoveTask(deps),
        trashTask: makeTrashTask(deps),
        listTrash: makeListTrash(deps),
        restoreTask: makeRestoreTask(deps),
        deleteForever: makeDeleteForever(deps),
        emptyTrash: makeEmptyTrash(deps),
      }),
    )
    .use(
      checklistsRouter({
        listChecklist: makeListChecklist(deps),
        addChecklistItem: makeAddChecklistItem(deps),
        updateChecklistItem: makeUpdateChecklistItem(deps),
        deleteChecklistItem: makeDeleteChecklistItem(deps),
        moveChecklistItem: makeMoveChecklistItem(deps),
      }),
    )
    .use(
      searchRouter({
        searchTasks: makeSearchTasks(sources),
        relatedTasks: makeRelatedTasks(sources),
        taskHighlights: makeTaskHighlights(sources),
      }),
    )
    .use('/api', routeNotFound)
    .use(makeErrorHandler(deps.logError));
};
