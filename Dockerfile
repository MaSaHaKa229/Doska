# syntax=docker/dockerfile:1.7
# Образы «Учебной доски»: сервер (backend) и сайт с Nginx (web).
#   docker compose build            — собирает оба (см. docker-compose.yml)
# Сертификат прокси при сборке за корпоративным прокси (необязательно):
#   docker build --secret id=npm_ca,src=/путь/ca.pem …
#   (через скрипты deploy/scripts — DOSKA_NPM_CA=/путь/ca.pem, см. docker-compose.npm-ca.yml)
# Зеркало движков Prisma, если binaries.prisma.sh недоступен (необязательно):
#   PRISMA_ENGINES_MIRROR в .env (передаётся сюда аргументом сборки).

ARG NODE_IMAGE=node:22.21-bookworm-slim
# Рабочий образ сервера — полный Debian: в нём есть OpenSSL (нужен движку Prisma)
# и сертификаты, системные пакеты ставить не нужно.
ARG RUNTIME_IMAGE=node:22.21-bookworm
ARG NGINX_IMAGE=nginx:1.28.0-alpine

# ---------------------------------------------------------------------
#  Зависимости и сборка всех пакетов
# ---------------------------------------------------------------------
FROM ${NODE_IMAGE} AS build
ARG PRISMA_ENGINES_MIRROR=
WORKDIR /app
ENV CI=1 NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
# Схема нужна prisma generate (postinstall бэкенда).
COPY backend/prisma backend/prisma
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=npm_ca,required=false \
    sh -c '[ -n "$PRISMA_ENGINES_MIRROR" ] || unset PRISMA_ENGINES_MIRROR; if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci'
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend
COPY frontend frontend
RUN npm run build

# ---------------------------------------------------------------------
#  Сервер: только рабочие зависимости бэкенда
# ---------------------------------------------------------------------
FROM ${RUNTIME_IMAGE} AS backend
ARG PRISMA_ENGINES_MIRROR=
WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY backend/prisma backend/prisma
RUN --mount=type=cache,target=/root/.npm \
    --mount=type=secret,id=npm_ca,required=false \
    sh -c '[ -n "$PRISMA_ENGINES_MIRROR" ] || unset PRISMA_ENGINES_MIRROR; if [ -s /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; npm ci --omit=dev -w @doska/backend -w @doska/shared --include-workspace-root=false'
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY deploy/backend-entrypoint.sh /usr/local/bin/doska-backend
RUN chmod 755 /usr/local/bin/doska-backend && mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["doska-backend"]

# ---------------------------------------------------------------------
#  Сайт: собранный фронтенд и Nginx (прокси /api и /ws к серверу)
# ---------------------------------------------------------------------
FROM ${NGINX_IMAGE} AS web
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx/doska-locations.conf /etc/nginx/doska/locations.conf
COPY deploy/nginx/http.conf.template deploy/nginx/https.conf.template /etc/nginx/doska/
COPY deploy/nginx/40-doska-config.sh /docker-entrypoint.d/40-doska-config.sh
RUN chmod 755 /docker-entrypoint.d/40-doska-config.sh && rm -f /etc/nginx/conf.d/default.conf
EXPOSE 80 443
