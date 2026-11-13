# syntax=docker/dockerfile:1

# Build stage: a static Vite build. Install scripts are skipped because no native module
# (better-sqlite3 belongs to the API) is needed to build the web app.
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
ARG APP_VERSION=1.0.0
# Only true shows the demo shortcut on the sign-in page: unset (production) leaves it off.
# `make local` sets it; `make cloud` only when SEED_DEMO=true.
ARG DEMO_SIGN_IN=
RUN APP_VERSION=$APP_VERSION DEMO_SIGN_IN=$DEMO_SIGN_IN npm run build -w @todo/web

# Runtime stage: nginx as a non-root user, listening on 8080.
FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/"]
