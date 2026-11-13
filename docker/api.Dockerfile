# syntax=docker/dockerfile:1

# Build stage: install every workspace, bundle the API, then keep only its runtime dependencies
# (the workspace links are dropped: the bundle already contains @todo/contracts).
FROM node:22-slim AS build
WORKDIR /app
# Compiler fallback in case better-sqlite3 has no prebuilt binary for this CPU.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY . .
RUN --mount=type=cache,target=/root/.npm npm ci
RUN npm run build -w @todo/api
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev -w @todo/api \
  && rm -rf node_modules/@todo \
  && mkdir -p apps/api/node_modules

# Runtime stage: Node, the bundle and its production modules, run as the unprivileged node user.
# The workspace layout is kept because npm may install a dependency (e.g. better-sqlite3) in
# apps/api/node_modules instead of the root one; Node looks in both, nearest first.
FROM node:22-slim
ENV NODE_ENV=production PORT=3000 DATABASE_FILE=/data/todo.db
WORKDIR /app/apps/api
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./package.json
COPY --from=build /app/apps/api/dist ./dist
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/server.js"]
