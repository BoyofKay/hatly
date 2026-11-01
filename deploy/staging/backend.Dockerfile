# Hatly backend image (Sales Staging). Build context = the repository ROOT:
#   docker build -f deploy/staging/backend.Dockerfile -t hatly-staging-backend:local .
# Multi-stage: production dependencies, a full build, and a slim runtime that runs the compiled app.
FROM node:22-bookworm-slim AS prod-deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages
RUN npm ci --omit=dev --workspace=apps/backend --include-workspace-root

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages
RUN npm ci --workspace=apps/backend --include-workspace-root
COPY apps/backend apps/backend
RUN cd apps/backend && npx nest build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=staging
WORKDIR /repo/apps/backend
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=prod-deps /repo/node_modules /repo/node_modules
# npm nests packages whose version differs from the hoisted copy under the workspace (firebase-admin 14 and its @google-cloud/@firebase
# chain live in apps/backend/node_modules, not in the root one) — the runtime image needs both or the backend cannot start.
COPY --from=prod-deps /repo/apps/backend/node_modules ./node_modules
COPY --from=build /repo/apps/backend/dist ./dist
# Fonts embedded in generated PDF exports (Arabic + Latin, SIL OFL). Resolved from the working directory: /repo/apps/backend/assets/fonts.
COPY apps/backend/assets ./assets
COPY apps/backend/package.json ./package.json
# Local-disk media (STORAGE_DRIVER=local): the compose file mounts a volume here.
RUN mkdir -p /data/uploads && chown -R node:node /data /repo/apps/backend
USER node
EXPOSE 3000
# `nest build` emits dist/src/main.js (the tsconfig also compiles test/, so there is no dist/main.js).
CMD ["node", "dist/src/main.js"]
