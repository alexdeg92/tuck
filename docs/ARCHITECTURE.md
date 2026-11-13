# Architecture

How Tuck is put together. The trade-offs behind these choices are in [DECISIONS.md](DECISIONS.md).

## Repository layout

```text
apps/api/            Express 5 REST API: modules/<feature>/{domain,application,infrastructure,http}
apps/web/            React 19 + Vite SPA: app/, features/<feature>/, shared/{api,ui,lib,pwa}
packages/contracts/  Zod schemas, the typed endpoint map and example payloads, shared by both apps
e2e/                 Playwright specs, run against the production build
docker/              API and web images, nginx config
scripts/             Repository checks (no debug leftovers, bundle budget, test Postgres)
```

npm workspaces: one TypeScript version, one ESLint + Prettier config and one test runner (Vitest) across the repo.

## Contracts (`packages/contracts`)

Every shape that crosses the network is a Zod schema, and its TypeScript type is inferred from it. Each endpoint is declared once, as data, in `endpoints.ts`:

```ts
createTask: endpoint({ method: 'POST', path: '/api/tasks', body: CreateTaskInput, status: 201, response: Task, … })
```

- **API:** `route(router, endpoints.createTask, handler)` parses params, query and body (400 on bad input), runs the handler, then **parses the reply against the contract before sending it**, so a drifting reply becomes a logged 500 instead of reaching a client.
- **Web:** `call(endpoints.createTask, request)` builds the URL, checks the status and parses the response with the same schema.
- **Tests:** every schema has example payloads in `examples/`; `api.contract.test.ts` calls every endpoint over HTTP and checks its status and body against the map.

Errors share one shape, `{ error: { code, message, details? } }`, with a closed set of codes: `VALIDATION_FAILED` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `INTERNAL` 500.

## REST API

JSON in and out under `/api`. Every task route requires a session. Any authenticated reply may carry a renewed session cookie; a refused one is cleared with the 401.

| Method | Path                                        | Success                                     | Errors                   |
| ------ | ------------------------------------------- | ------------------------------------------- | ------------------------ |
| POST   | `/api/auth/signup`                          | 201 `User` + session cookie                 | 400, 409 email taken     |
| POST   | `/api/auth/login`                           | 200 `User` + session cookie                 | 400, 401, 429            |
| POST   | `/api/auth/logout`                          | 204, cookie cleared                         |                          |
| POST   | `/api/auth/logout-all`                      | 204, every session of the account revoked   | 401                      |
| GET    | `/api/auth/me`                              | 200 `User`                                  | 401                      |
| GET    | `/api/tasks?q=`                             | 200 `{ items: Task[] }` in the user's order | 400, 401                 |
| POST   | `/api/tasks`                                | 201 `Task`, placed at the top               | 400, 401, 409            |
| GET    | `/api/tasks/:id`                            | 200 `Task`                                  | 400, 401, 404            |
| PATCH  | `/api/tasks/:id`                            | 200 `Task`                                  | 400, 401, 404, 409 stale |
| DELETE | `/api/tasks/:id`                            | 200 `TrashedTask` (moved to the trash)      | 401, 404                 |
| POST   | `/api/tasks/:id/move`                       | 200 `Task` with its new position            | 400, 401, 404, 409       |
| POST   | `/api/tasks/:id/restore`                    | 200 `Task`, back in its place               | 401, 404                 |
| GET    | `/api/trash`                                | 200 `TrashList`                             | 401                      |
| DELETE | `/api/trash`, `/:id`                        | 204, deleted for good                       | 401, 404                 |
| \*     | `/api/tasks/:id/checklist[/:itemId[/move]]` | checklist item CRUD and reorder             | 400, 401, 404, 409       |
| GET    | `/api/search?q=`                            | 200 ranked hits with snippets               | 400, 401, 429            |
| GET    | `/api/tasks/:id/related`, `/highlights?q=`  | related tasks, match ranges in a task       | 401, 404                 |
| GET    | `/api/health`                               | 200 `{ status: 'ok', version }`             |                          |

- **Ownership:** every repository method takes the user id, so someone else's task is indistinguishable from a missing one: **404, never 403**, and the API never confirms that an id exists. `FORBIDDEN` (403) is in the contract, but no route needs it until tasks can be shared.
- **Stale writes:** an autosave sends `expectedUpdatedAt`; if the task changed in between, the reply is 409 with the current task, and nothing is written.

## Backend (`apps/api/src`)

```text
modules/
  auth/        sign-up, sign-in, session; scrypt hasher, jose tokens
  tasks/       CRUD, ordering, completion, trash and its hourly purge (the base module)
  checklists/  items inside a task, owned through the task
  search/      pure ranking, typo tolerance, related tasks, under a fixed work budget
  notes/       formatted-notes normalisation
  demo/        the idempotent demo-content ledger
shared/        route(), error mapping, JSON-only guard, rate limits, config, DB connections and migrations
app.ts         composition root: repositories → use cases → routers
server.ts      config, storage, seed, listen, graceful shutdown
```

- **Layers point inward:** `http → application → domain`; `infrastructure` implements the application's ports. The domain imports nothing from Express or a database. Feature modules depend one way (search → checklists → tasks; auth stands alone). `dependency-cruiser` enforces every rule in CI.
- **Use cases are functions built by higher-order factories**, with their dependencies injected: `makeCreateTask({ tasks, clock, ids }) => (userId, input) => Promise<Task>`. No classes, so tests swap the database, the clock and the id generator freely.
- **Errors:** use cases reject with typed domain errors (`notFound()`, `conflict()`…); only `shared/http/errors.ts` maps them to statuses. Express 5 forwards async errors itself, so there is no async wrapper.
- **One repository contract suite per port** runs against the in-memory, SQLite and Postgres adapters, which proves they are interchangeable.

## Ordering

`position` is a fractional-index string key, compared byte by byte. Moving task X after A stores a key between A and A's successor: **one row written**, whatever the list size. The client sends intent (`afterId`), never positions.

- New tasks go to the top. Completed tasks follow the open ones, most recently completed first, and keep their key, so reopening a task puts it back where it was. Only open tasks can be reordered (otherwise 400).
- **Concurrency:** two moves for the same user must not interleave. SQLite transactions are synchronous; on Postgres each insert or move first takes a per-user transaction-scoped advisory lock. `UNIQUE(user_id, position)` is the backstop: the use case retries once with fresh neighbours, then answers 409. The shared suite races crossed moves on every engine. The per-user lock doesn't hold off a trash, so the move's `UPDATE` re-checks `deleted_at IS NULL` itself: a task trashed between the move's read and its write is skipped and keeps its reserved key.

## Data

`storage.ts` picks the engine at boot: **Postgres when `DATABASE_URL` is set**, otherwise a SQLite file (`better-sqlite3`). Migrations are numbered SQL files per engine, applied in order and recorded in `schema_migrations`; on Postgres they run in one transaction under an advisory lock, so several instances can start together. Invariants live in the schema (`UNIQUE(email)`, `UNIQUE(user_id, position)`, `CHECK` on status and priority), and all SQL uses bound parameters.

- **Trash:** a delete sets `deleted_at`; every other read filters it out. A restore only clears it, and a single set-based `DELETE` purges tasks older than 30 days, at boot and then hourly (idempotent, so safe on several instances).
- **Checklists:** items reference their task with `ON DELETE CASCADE`, are always reached through the task's owner, and are capped at 50 per task.
- **Demo content:** the demo account is seeded through the app's own use cases; a per-account ledger records what was added, so a restart never re-adds a task the user deleted.

## Search

A pure domain module over the signed-in user's own tasks, so memory, SQLite and Postgres return the same answer by construction (no `LIKE` or collation differences).

- **Folding:** accents and case are removed (`École` ~ `ecole`) while each character remembers its source offset, so highlights point at the original text.
- **Ranking:** every query word must match; a match scores field weight (title 3, checklist item 2, notes 1) × match class (whole word 4, prefix 3, inside a word 2). Open tasks rank before completed ones.
- **Typo tolerance:** only when nothing matches as typed. Each word may match within an edit budget that grows with its length, or by sound (`fone` → phone); the reply carries a "did you mean" suggestion.
- **Bounded work:** each request gets a fixed work budget that every stage reserves before running. When it runs out, the reply says `truncated: true` instead of running long. Search is also rate-limited per user.
- The list filter (`GET /api/tasks?q=`) is a plain folded substring match on title and notes.

## Authentication

- Passwords are hashed with `scrypt` (random salt, `timingSafeEqual`). An unknown email still runs a dummy compare, so timing doesn't reveal which accounts exist, and both cases return the same 401.
- The session is a 1-hour HS256 JWT in an **httpOnly, SameSite=Lax cookie** (`Secure` in production). The API accepts only `application/json` bodies, which a cross-site form cannot send.
- Sessions slide: a token past half its life is re-issued on the next request, so an active user stays signed in and an idle one is signed out after an hour. Renewals stop 7 days after sign-in (`auth/domain/sessionPolicy.ts`).
- Revocation: the JWT carries a session version (`sv`). The user row is loaded on every request anyway, so a token behind `users.session_version` (migration 007) gets a 401 and its cookie cleared. `POST /api/auth/logout-all` bumps the version in one atomic `UPDATE`, ending every session of the account on every device; `POST /api/auth/logout` only clears this device's cookie.
- `/api/auth/*` is rate-limited per client address. `JWT_SECRET` is parsed at startup; production refuses to boot without a real one.

## Frontend (`apps/web/src`)

```text
app/                 router, providers, the cross-feature composition
features/auth/       sign-in and sign-up pages, session hooks
features/tasks/      list and detail pages, reorder, gestures, autosave, optimistic mutations
features/search/     search bar, highlights, in-task finder
features/trash/      the /trash page, restore, delete forever, empty trash, the app-wide Undo offer
shared/api/http.ts   the one fetch wrapper: credentials, ApiError decoding, contract parsing
shared/ui/           design-system primitives (CSS Modules + design tokens)
```

- **Data flow:** component → hook → feature `api.ts` → `shared/api/http.ts`. Components never call `fetch`, and every response is parsed with its contract schema.
- **TanStack Query** owns server state: caching, refetching, optimistic toggle, reorder and delete, then reconciliation with the server once the last change settles. Signing in as someone else clears the previous user's cache.
- **Features never import each other.** A host feature declares typed slots (for example `features/tasks/searchSlots.ts`) and `app/router.tsx` fills them, so only `app/` knows both features. Moving a task to the trash goes through one shared seam (`shared/lib/trashUndo.ts`): the tasks feature reports the trashed task, and the trash feature, mounted above every route, offers "Moved to trash · Undo".
- **Routing:** `/signin`, `/signup`, `/tasks`, `/tasks/:id`, `/trash`, `/trash/:id`. A guard sends signed-out users to `/signin`, and a 401 from any request clears the session.
- **Trash:** moving a task needs no confirmation (Undo restores it on the server, in its old place); Delete forever and Empty trash are behind a confirmation dialog. On phones a row swipes right to the trash and left to complete; `swipeAction` in `gestures/rowGestures.ts` is the one place that maps a direction to an action.
- **Reorder:** dnd-kit with pointer, touch and keyboard sensors and screen-reader announcements; a drop sends `afterId`.
- **Autosave:** title and notes save 700 ms after typing stops, one request in flight per task, with `expectedUpdatedAt`. A real conflict keeps the user's text and asks (Keep mine / Use theirs); failed saves retry with backoff and resume when the browser is back online.
- **Installable:** a small hand-written service worker caches the app shell and static assets only, never `/api` responses. A new release refreshes open windows once pending saves have finished; while saves hold it back, an "A new version is ready · Reload" notice retries the same flush before reloading. Search focus never blocks an update, and returning to the page checks for a new release.

## Quality gates

`npm run check` (also run by CI): Prettier, ESLint (`strictTypeChecked`, exhaustive switches, no `console`), `tsc --noEmit`, dependency-cruiser, Vitest with coverage (85% line minimum per workspace), the production build, and `scripts/check-no-debug.mjs` (no debug logging, `debugger` statements or leftover to-do markers). CI also runs the repository suites on a real Postgres and the Playwright suite in three shards.
