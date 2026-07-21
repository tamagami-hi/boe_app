FROM node:22.20.0-alpine3.22@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af AS base

WORKDIR /app

RUN npm install --global npm@11.16.0

FROM base AS dependencies

COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM base AS production-dependencies

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev

FROM node:22.20.0-alpine3.22@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=47502

COPY --from=production-dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json package-lock.json ./
# SQL migrations are not compiled into dist; the migrate command reads them from
# ./db/migrations at runtime, so they must be present in the image.
COPY --chown=node:node db/migrations ./db/migrations

USER node

EXPOSE 47502

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 47502) + '/health/live').then(async response => { const body = await response.json(); if (!response.ok || body?.status !== 'ok') process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", "dist/server.js"]
