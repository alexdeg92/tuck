# Tuck

A full-stack to-do app: sign in, then create, order, search, edit and delete your own tasks, on desktop or phone.
React client, Node/Express REST API, with request and response shapes shared through Zod contracts.

**Live demo:** <https://note.perroquet.io> (`demo@example.com` / `demo1234`)

## Run it on a Mac

Needs [Docker Desktop](https://www.docker.com/products/docker-desktop/) and `make` (`xcode-select --install`).

```sh
git clone https://github.com/alexdeg92/tuck.git && cd tuck
make local          # http://localhost:8080 (SQLite, no other setup)
```

Or without cloning, from the published images:

```sh
curl -fsSL https://raw.githubusercontent.com/alexdeg92/tuck/main/compose.quickstart.yml -o compose.yml && docker compose up
```

Sign in with `demo@example.com` / `demo1234`. `make local-down` (or `docker compose down`) stops it.

## Try the cloud topology locally

With no `.env`, `make cloud` builds this checkout and starts six containers: Traefik,
nginx, two APIs, Postgres and Redis. Open <http://localhost:8081> and sign in with
`demo@example.com` / `demo1234`. No DNS or certificates are needed. Docker Desktop
on Intel and ARM Macs is supported. `make cloud CLOUD_LOCAL_PORT=8082` changes the
loopback port; `make local LOCAL_PORT=8080` can run alongside it.

`make cloud-down` keeps data; `make cloud-logs` follows logs. Local cloud uses its
own `tuck-cloud-local` project, volumes and `.env.cloud-local.secret`. Keep the same
configuration when stopping or inspecting a stack: setting production selectors
changes which stack these commands address.

## Deploy to the cloud

```sh
cp .env.example .env   # set DOMAIN and ACME_EMAIL
make cloud
```

```text
HTTPS → Traefik ─┬─ /*     → web (nginx)
                 └─ /api/* → API × 2 (stateless) ─┬─ Postgres 16
                                                  └─ Redis 7 (shared rate limits)
```

Traefik handles TLS (Let's Encrypt) and load balancing. JWT sessions are stateless, so any replica can serve any request. Images are published to GHCR (amd64 and arm64). See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for options and for scaling out to ECS, Kubernetes or Cloud Run.

## Tests

```sh
make check   # format, lint, types, architecture rules, unit + integration tests, build
make e2e     # Playwright, desktop and phone
```

Unit and integration tests use Vitest (Jest-compatible API) with Testing Library for the React app and Supertest for the API; end-to-end tests use Playwright. 1,750 unit and integration tests, 111 more against real Postgres and Redis, and 222 end-to-end tests. Line coverage: API 99%, web 95%, contracts 100%. All of it runs in CI; the full table is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#tests).

## Assignment summary

### Overall approach

- **Contract first.** Every endpoint and payload is a Zod schema in `packages/contracts`, parsed by both the API and the client, so the two can't drift.
- **Layered, functional backend.** Each feature has domain, application (use cases), infrastructure and http layers. Use cases are plain functions built by factories with injected dependencies (`makeCreateTask({ tasks, clock, ids })`). CI rejects dependencies that point the wrong way.
- **The API owns the rules.** It handles ownership, validation, ordering and search, with standard REST status codes. Storage can be SQLite or Postgres behind the same repository ports.
- **Status codes:** another user's task returns 404, not 403, so the API never confirms that a task id exists; a missing, expired or revoked session is a 401.
- **Sessions:** a stateless JWT in an httpOnly cookie, checked against a per-user session version when the user is loaded on each request. It slides while you're active, stops at 7 days, and "Sign out everywhere" revokes every device.
- **High-level async.** TanStack Query manages server state with optimistic updates. The server uses transactions and a per-user lock.
- **Test-driven.** Fixes start from a failing test, and one repository contract suite runs against memory, SQLite and Postgres.

More in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/DECISIONS.md](docs/DECISIONS.md).

### Features completed

- Sign in, sign up, sign out, and sign out everywhere (every device).
- Your own task list, reorderable by mouse, touch or keyboard, with the order saved on the server.
- Search as you type, with typo tolerance and highlighted matches.
- Task detail screen with autosaved title and notes, plus priority, due date and done.
- Full CRUD. Delete is a soft delete: the task goes to a 30-day Trash, and you can Undo or restore it.
- Responsive. On phones, swipe left to complete and swipe right to delete.
- Installable as a PWA.

### Given more time: features (with estimates)

| Feature                                                                  | Estimate |
| ------------------------------------------------------------------------ | -------- |
| Checklists and rich-text notes in the UI (the API already supports them) | 2–3 days |
| Labels and filters                                                       | 4 h      |
| Reminders (email or push)                                                | 1 day    |
| Shared lists with roles                                                  | 2 days   |
| Offline editing                                                          | 1–2 days |

### Given more time: robustness (with estimates)

| Improvement                                                                     | Estimate |
| ------------------------------------------------------------------------------- | -------- |
| Structured logs, metrics, tracing (OpenTelemetry)                               | 1 day    |
| Infrastructure as code (Terraform)                                              | 1 day    |
| Email verification on sign-up (sign-up's 409 currently reveals a taken address) | 1 day    |
| Automated backups and a restore drill                                           | 4 h      |
| Cross-browser e2e and dependency scanning in CI                                 | 4 h      |
