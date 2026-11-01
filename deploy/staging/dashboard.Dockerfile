# Hatly dashboard image (Sales Staging). Build context = the repository ROOT:
#   docker build -f deploy/staging/dashboard.Dockerfile \
#     --build-arg NEXT_PUBLIC_API_BASE_URL=https://api-sales.hatly.dev/api/v1 -t hatly-staging-dashboard:local .
# NEXT_PUBLIC_API_BASE_URL is compiled INTO the browser bundle, so it must be the public HTTPS API URL at build time.
FROM node:22-bookworm-slim AS build
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages packages
RUN npm ci --workspace=apps/dashboard --include-workspace-root
COPY apps/dashboard apps/dashboard
# Tailwind only compiles when apps/dashboard/postcss.config.js exists (without it the stylesheet is ~100 bytes and the dashboard renders
# UNSTYLED). The file now lives in the repository; fail the build loudly instead of silently shipping an unstyled dashboard.
RUN test -f apps/dashboard/postcss.config.js
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" && cd apps/dashboard && npx next build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=build /repo /repo
WORKDIR /repo/apps/dashboard
USER node
EXPOSE 3001
CMD ["npx", "next", "start", "-p", "3001"]
