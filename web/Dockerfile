# Production build of the PWA served by nginx, for running the whole app locally in Docker
# (root docker-compose.yml). Vercel does not use this file.

# ── Build stage ───────────────────────────────────────────────────────────────
# Same Node as api/Dockerfile and the root .nvmrc.
FROM node:26.13.1-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Runtime stage: static files + /api proxy ─────────────────────────────────
FROM nginx:1.27-alpine

# The official image runs envsubst on templates/*.template at start, so API_UPSTREAM (set by
# compose) picks the API container, like API_ORIGIN does for middleware.js on Vercel.
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist/tang-pai-nai-web/browser /usr/share/nginx/html

EXPOSE 80
