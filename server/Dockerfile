# syntax=docker/dockerfile:1

# ---- stage 1: build the dashboard ----
FROM node:24-alpine AS dashboard
WORKDIR /build
COPY package.json package-lock.json ./
COPY dashboard/package.json dashboard/
RUN npm ci -w dashboard
COPY dashboard/ dashboard/
RUN npm -w dashboard run build

# ---- stage 2: build the server ----
FROM node:24-alpine AS server
WORKDIR /app
RUN apk add --no-cache docker-cli docker-cli-compose git
COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci -w server
COPY server/ server/
RUN npm -w server run build
COPY --from=dashboard /build/dashboard/dist /app/dashboard-dist

# non-root, but able to use the host docker group
ARG DOCKER_GID=999
RUN addgroup -g ${DOCKER_GID} dockersock && addgroup node dockersock && mkdir -p /data/apps /data/logs/deployments /data/nginx /var/www/certbot && chown -R node:node /data /var/www/certbot

USER node
WORKDIR /app/server
EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
