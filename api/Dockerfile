# Debian slim (glibc) rather than Alpine (musl): prebuilt native modules a project
# may add later (bcrypt, sharp, ORM engines, …) work without compiling.
# Pin the exact version so builds are reproducible; bump it deliberately.

# ── Build stage: full deps + compile ──────────────────────────────────────────
FROM node:24.20.0-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Compile during image build (build has more memory than the running instance)
# so startup never runs tsc — avoids OOM on small/free hosting plans.
RUN npm run build

# ── Runtime stage: compiled output + production deps only ────────────────────
FROM node:24.20.0-slim
WORKDIR /app

# Default to production so a plain `docker run` / `docker compose up` behaves like
# a real deployment (e.g. Render). Override with `-e NODE_ENV=development`.
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Winston writes to ./logs; let the non-root user create files there.
RUN mkdir logs && chown node:node logs
USER node

EXPOSE 3000

# Run node directly (not `npm start`) so SIGTERM reaches the app and graceful
# shutdown + onShutdown hooks run. Env vars come from the platform (Render
# dashboard, compose env_file), never from a file baked into the image.
CMD ["node", "dist/main.js"]
