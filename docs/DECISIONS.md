# Decisions

The choices that shape Tuck, each with its trade-off. The layers, the contract and the data model are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Application

- **Session in an httpOnly, SameSite=Lax cookie** rather than a Bearer token: page scripts can't read it, so an XSS bug can't steal it, and the client needs no token storage. Cross-site writes are blocked by SameSite plus JSON-only request bodies.
- **Sessions: a stateless JWT plus a per-user session version, not a token store.** Every request already loads the user, so comparing one integer revokes for free: "Sign out everywhere" bumps it and every API instance refuses older tokens on their next request. The cost: revocation is per account, not per device (a normal sign-out just drops this device's cookie). Short tokens that slide (re-issued past half their life, capped at 7 days from sign-in) replace refresh tokens: one cookie, no refresh endpoint, no rotation bookkeeping.
- **Fractional-index ordering:** a move writes one row (a string key between its neighbours) instead of renumbering the list. Keys can grow after many moves into the same gap; a rare rebalance would fix that (not built yet).
- **Someone else's task returns 404, not 403**, so the API never confirms that an id exists.
- **scrypt from `node:crypto`** for passwords: memory-hard, built in, no native dependency.
- **better-sqlite3 on a laptop, Postgres for several instances:** both sit behind the same repository ports and pass the same contract suite. SQLite is synchronous, simple to read and prebuilt for macOS; Postgres is selected by `DATABASE_URL`. Migrations are numbered SQL files run by a small tested runner, so every query is visible.
- **No native browser UI; React Aria for the two hard controls.** The priority menu and the due-date picker are custom (`shared/ui/Select`, `shared/ui/DatePicker`), styled with the design tokens, because the OS-drawn `<select>` menu and date panel can't be styled or animated. Their behaviour comes from `react-aria-components` (Adobe, pinned exactly with `react-aria` for its portal provider): keyboard, typeahead, segmented date editing, calendar navigation, focus return and screen-reader announcements are what an accessible select or date picker needs and what we shouldn't hand-roll. It is headless, so all the visuals stay ours; Radix has no date picker and MUI brings its own design system. A lint rule bans `<select>`, date/time/colour inputs and `alert`/`confirm`/`prompt` in the web app.
- **Every control animates every state** (hover, press, release, focus, change, disabled) on the motion tokens, and reduced motion keeps only short crossfades. A static coverage table (`styles/motion.test.ts`) and a browser spec (`e2e/tests/motion.spec.ts`) enforce it.

## Delivery

- **One image pair everywhere:** the API image (Node, unprivileged user, healthcheck) and the web image (the static build in unprivileged nginx, which also proxies `/api`, so the browser sees one origin and needs no CORS). `make local` and `make cloud` run the same images.
- **Traefik at the edge in the cloud:** it discovers the web container from Docker labels, obtains and renews the Let's Encrypt certificate itself, redirects HTTP to HTTPS and adds HSTS, so there are no certificates or proxy rules to maintain by hand. nginx stays behind it for static caching headers and the API proxy.
- **SQLite on one volume for a single VM, Postgres beyond:** a SQLite file has one writer, so `make local` runs one API on it. `make cloud` sets `DATABASE_URL` and runs two replicas on Postgres: migrations, the per-user ordering lock and the trash purge are safe on several instances (see [DEPLOYMENT.md](DEPLOYMENT.md#scaling-to-a-distributed-cloud)).

## Data store: relational

**Why relational (and not DynamoDB or MongoDB).** Each write is a small transaction that must keep an invariant, and a relational database states those invariants as constraints:

| Access pattern                                    | Relational (SQLite here, Postgres in the cloud)                             | DynamoDB / MongoDB                                                                                                                                    |
| ------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unique email at sign-up                           | `UNIQUE(email)`                                                             | DynamoDB: a hand-built guard item per email, in a transaction. MongoDB: a unique index                                                                |
| Two moves into the same gap: retry once, then 409 | `UNIQUE(user_id, position)`: the second writer gets a unique violation      | DynamoDB has no secondary uniqueness: a per-user version item and conditional transactions. MongoDB: a unique index plus a multi-document transaction |
| A user only sees their own tasks                  | `WHERE id = ? AND user_id = ?`                                              | DynamoDB: structural through the partition key. A draw                                                                                                |
| Future: shared lists, labels                      | join tables with foreign keys                                               | DynamoDB: the partition key changes from user to list, so the table is redesigned                                                                     |
| Search                                            | the user's own tasks, scored in one domain module, the same on every engine | the same per-user approach in every engine: no difference                                                                                             |
| Cost at small scale                               | RDS has a fixed floor (about $50 a month)                                   | DynamoDB on demand costs cents: the one row where it wins                                                                                             |
| Local development on a Mac                        | a file, no account                                                          | an emulator or Docker                                                                                                                                 |

## Search: in the domain, not in SQL

- **What:** smart search (ranking, typo tolerance with a "did you mean", related tasks) is one pure module in `apps/api/src/modules/search/domain/`. It runs over the signed-in user's own tasks and checklist items, which the repositories only read. The details are in [ARCHITECTURE.md](ARCHITECTURE.md#rest-api).
- **Why:** memory, SQLite and Postgres return the same answer by construction, with no `LIKE`, collation or engine-specific full-text index to reconcile, and the whole algorithm is unit-testable.
- **Its guard:** every request has a fixed work budget. When it runs out the reply is marked `truncated`, so a hostile query costs a bounded amount of CPU, and search is also rate-limited per user.
- **Trade-off:** each search reads the user's whole corpus. That's cheap at the sizes a personal list reaches (about 5 ms for 300 tasks). A user with tens of thousands of tasks would need an index (Postgres full-text or trigram), at the price of engine-specific behaviour. "Related" is lexical (shared words), not semantic.
