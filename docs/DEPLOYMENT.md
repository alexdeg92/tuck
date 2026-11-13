# Deployment, development and tests

The details behind the [README](../README.md).

## Local cloud topology

Without DOMAIN or ACME_EMAIL in `.env` or the shell, `make cloud` runs the same six
containers over HTTP at `http://localhost:8081`, bound only to IPv4 loopback. It
always builds API and web from the current checkout; it never pulls app images.
Set `CLOUD_LOCAL_PORT` in the shell or with Make to choose another port. There is
no DNS, ACME, HTTPS redirect or HSTS; cookies work over HTTP and demo login is enabled.
Images have no fixed CPU platform and build on Docker Desktop Intel and ARM Macs.

`compose.cloud.local.yml` is separate from the secure production configuration.
Project `tuck-cloud-local`, its Postgres volume and `.env.cloud-local.secret` are
independent of production (`tuck-cloud`, `.env.secret`) and SQLite local (`tuck`).
Inherited `COMPOSE_PROJECT_NAME` is ignored. Each Traefik discovers only its own
project. Secrets are generated once with restricted permissions, never printed.
Keep secrets alongside their database volumes; changing a password file does not
change an existing Postgres volume's password. Stop/log commands use the same
selector rules and do not generate secrets. They retain volumes.

The dispatcher reads literal quoted or unquoted DOMAIN/ACME_EMAIL, optional
`export`, comments and CRLF without sourcing shell code. Shell selectors take
precedence. Either selector being present requires both valid nonempty values;
interpolation and malformed selectors fail before Docker is called. A development
`.env` containing neither selector selects localhost. Preserve the configuration
when using `make cloud-down` or `make cloud-logs`; those commands target the currently
selected stack. Run `npm run test:scripts` for dispatcher regression tests.

## `make cloud` on a VM

Runs the production stack as a small distributed system: **Traefik** terminates HTTPS with a Let's Encrypt certificate it obtains and renews itself, serves the web app through nginx and load-balances `/api` across **two stateless API replicas** (only healthy ones, retrying a request a stopping replica drops). The session is a signed JWT cookie with no server-side store, so any replica serves any request and no sticky sessions are needed. The replicas share **Postgres 16** (on a named volume; migrations and the demo seed are safe when both start at once) and **Redis 7**, which holds the rate-limit counters so a limit is enforced across replicas, not per process. Every container has a healthcheck, and the API starts only once Postgres and Redis are healthy. `make local` stays a single API on one SQLite file, with an in-memory rate limit.

```text
browser ── HTTPS ── Traefik ─┬─ /*      → web (nginx, the static app)
                             └─ /api/*  → api × 2 (round robin, healthy only) ─┬─ Postgres 16 (named volume)
                                                                               └─ Redis 7 (rate-limit counters)
```

1. Create a VM (AWS EC2, GCP, Azure, DigitalOcean…) with Docker Engine and the Compose plugin, and open ports 80 and 443.
2. Point a DNS record (for example `todo.example.com`) at its public IP.
3. On the VM:

   ```sh
   git clone https://github.com/alexdeg92/tuck.git && cd tuck
   cp .env.example .env    # then set DOMAIN and ACME_EMAIL
   make cloud
   ```

`make cloud` pulls the images CI publishes to GHCR (`ghcr.io/alexdeg92/tuck-api` and `tuck-web`, multi-arch amd64 and arm64; set `IMAGE_TAG` to pin a release). When they can't be pulled it builds them from source on the VM instead, and `make cloud BUILD=1` always builds from source.

The app is then at `https://$DOMAIN`. `make cloud` stops with a clear message if either production selector is present but `DOMAIN` or `ACME_EMAIL` is missing. A random session secret and Postgres password are generated once into `.env.secret` (gitignored). Optional settings in `.env`: `ACME_CA_SERVER` for Let's Encrypt staging while testing, `SEED_DEMO=true` for the demo account, `API_REPLICAS` (default 2), `HTTP_PORT`/`HTTPS_PORT`. `make cloud-logs` follows the logs (Traefik's access log names the replica that served each request); `make cloud-down` stops the stack and keeps the database and certificates.

## Scaling to a distributed cloud

`make cloud` runs the distributed shape on one VM. Spreading it over several machines is configuration, not code: the same images, with managed Postgres and Redis. On AWS, for example:

```text
CloudFront ─┬─ /*      → S3 (the static web build)
            └─ /api/*  → ALB → API containers on ECS Fargate, in several AZs (autoscaled)
                                  ├─ RDS Postgres, Multi-AZ
                                  └─ ElastiCache Redis (rate limits)
```

- **Database:** set `DATABASE_URL` and the API uses Postgres instead of SQLite. Migrations run in one transaction under an advisory lock, so instances can start together; task ordering takes a per-user lock; the trash purge is a single idempotent `DELETE`. The Postgres adapters pass the same contract suite as SQLite in CI.
- **API:** stateless. The session is a signed cookie, so any instance can serve any request; `JWT_SECRET` comes from a secret store (AWS Secrets Manager or SSM).
- **Web:** the `apps/web/dist` build is static files; hashed assets are cached for a year, `index.html` and the service worker are revalidated. With one CloudFront origin the API stays same-origin, so no CORS is needed.
- **Rate limits:** set `REDIS_URL` (ElastiCache) and every instance counts in Redis, one key prefix per limiter; the API refuses to start if it is set but unreachable. Unset, each process counts in memory.
- **What to add:** centralised logs, metrics and tracing (OpenTelemetry).

The same layout maps to Kubernetes (a Deployment behind an Ingress, a managed Postgres) or to Google Cloud Run with Cloud SQL.

## Development

Node 22.12+ (`nvm use` reads `.nvmrc`):

```sh
npm ci && cp .env.example .env
npm run dev         # API on :3000, web app on the URL Vite prints (it proxies /api)
```

The API stores data in `apps/api/data/todo.db`; set `DATABASE_URL=postgres://…` to use Postgres instead.

## Tests

```sh
make check        # everything CI runs: format, lint, types, architecture, tests with coverage, build, no-debug
make test         # unit and integration tests only
make e2e          # builds, then runs the Playwright suite
npm run test:pg   # the repository suites and the Redis rate limit on a throwaway Postgres and Redis in Docker
```

| Suite                                      | Tests | Line coverage | What it covers                                                               |
| ------------------------------------------ | ----- | ------------- | ---------------------------------------------------------------------------- |
| API (Vitest, Supertest)                    | 661   | 99.2%         | use cases, every route over HTTP, one repository suite on memory and SQLite  |
| API on Postgres and Redis (`test:pg`)      | 111   | 98.0%         | the repository suites on a real Postgres, the rate limit on a real Redis     |
| Web (Vitest, Testing Library)              | 763   | 95.2%         | hooks, API adapters, components and pages                                    |
| Contracts                                  | 286   | 100%          | every schema against its example payloads and edge cases                     |
| Repository scripts                         | 40    |               | the no-debug check, the bundle budget, the architecture rules                |
| End-to-end (Playwright, desktop and phone) | 222   |               | the whole journey, sign-up, layout on every screen size, accessibility (axe) |

CI fails when line coverage drops below 85% in the API or contracts, or 90% in the web app. It runs `npm run check` with a bundle-size budget, the Postgres and Redis suites, and the end-to-end suite in three shards.
