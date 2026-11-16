# syntax=docker/dockerfile:1
# Gemeinsames Image-Rezept für Backend (mit Admin-Oberfläche) und Web-Vorschau der App.
# Gestartet wird alles über docker-compose.yml:  docker compose up --build

FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY app/package.json app/
RUN npm ci --no-audit --no-fund

# --------------------------------------------------------------- Backend + Admin
FROM deps AS backend
COPY packages/shared packages/shared
COPY backend backend
COPY data data
COPY docker/backend-entrypoint.sh /usr/local/bin/backend-entrypoint.sh
RUN chmod +x /usr/local/bin/backend-entrypoint.sh && mkdir -p /app-data
ENV NODE_ENV=development \
    PORT=8787 \
    STORAGE_DIR=/app-data/storage \
    ENV_FILE=/app-data/secrets.env
WORKDIR /repo/backend
EXPOSE 8787
ENTRYPOINT ["backend-entrypoint.sh"]

# --------------------------------------------------------------- Web-Vorschau der App
FROM deps AS web-build
COPY packages/shared packages/shared
COPY app app
# Adresse des Backends, so wie der Browser es erreicht (wird beim Bauen fest eingebaut).
ARG EXPO_PUBLIC_API_URL=http://localhost:8787
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL} \
    EXPO_NO_TELEMETRY=1 \
    CI=1
RUN cd app && npx expo export -p web --output-dir dist-web

FROM node:22-bookworm-slim AS web
WORKDIR /repo
COPY tools/dev/serve-web.mjs tools/dev/serve-web.mjs
COPY --from=web-build /repo/app/dist-web app/dist-web
EXPOSE 8790
CMD ["node", "tools/dev/serve-web.mjs", "8790"]
