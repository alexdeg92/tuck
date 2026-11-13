# `make` (or `make help`) lists the targets. Works with the GNU make shipped on macOS and Linux.
.DEFAULT_GOAL := help
SHELL := /bin/sh

LOCAL_PORT ?= 8080
export LOCAL_PORT
CLOUD_LOCAL_PORT ?= 8081
export CLOUD_LOCAL_PORT

# SQLite local and public cloud keep .env.secret; localhost cloud uses its own
# .env.cloud-local.secret. All are gitignored and generated once.
COMPOSE_LOCAL := docker compose --project-name tuck --env-file .env.secret -f docker-compose.yml

help: ## List the targets
	@awk 'BEGIN { FS = ":.*## " } /^[a-z0-9-]+:.*## / { printf "  %-12s %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

local: .env.secret ## Run the app on this machine at http://localhost:8080 (Docker, no TLS)
	$(COMPOSE_LOCAL) up --build --detach --wait
	@echo "Tuck is up: open http://localhost:$(LOCAL_PORT) and sign in as demo@example.com / demo1234"

cloud: ## Run six-container cloud on localhost:8081, or HTTPS with DOMAIN and ACME_EMAIL
	@sh scripts/cloud.sh up

local-down: .env.secret ## Stop the local stack (data is kept in a Docker volume)
	$(COMPOSE_LOCAL) down

cloud-down: ## Stop the selected cloud stack (data is kept)
	@sh scripts/cloud.sh down

local-logs: .env.secret ## Follow the local stack's logs
	$(COMPOSE_LOCAL) logs --follow

cloud-logs: ## Follow the selected cloud stack's logs
	@sh scripts/cloud.sh logs

dev: ## Run the API and the Vite dev server with hot reload (needs Node 22.12+ and npm ci)
	npm run dev

test: ## Unit and integration tests
	npm test

check: ## Every quality gate CI runs: format, lint, types, architecture, coverage, build
	npm run check

e2e: ## Build, then run the Playwright end-to-end suite
	DEMO_SIGN_IN=true npm run build
	npm run e2e

.env.secret: FORCE
	@umask 077; for name in JWT_SECRET POSTGRES_PASSWORD; do \
		grep -qs "^$$name=" $@ || { printf '%s=%s\n' "$$name" "$$(openssl rand -hex 32)" >> $@ && echo "Added a random $$name to $@"; }; \
	done

FORCE:

.PHONY: FORCE help local cloud local-down cloud-down local-logs cloud-logs dev test check e2e
