FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps

WORKDIR /workspace

COPY package.json package-lock.json ./
COPY app ./app
COPY packages ./packages
RUN npm ci

FROM deps AS builder

WORKDIR /workspace

ARG VITE_BEO_API_MODE=http
ARG VITE_BEO_API_BASE_URL=http://localhost:47502
ARG VITE_BEO_APP_TARGET=client
ENV VITE_BEO_API_MODE=${VITE_BEO_API_MODE}
ENV VITE_BEO_API_BASE_URL=${VITE_BEO_API_BASE_URL}
ENV VITE_BEO_APP_TARGET=${VITE_BEO_APP_TARGET}

RUN npm --workspace app run build

FROM nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim@sha256:762e8e4e5e103817c4158400fc3753c8e713ff8153b8c3afbb458ae4572bc9a3 AS runtime

COPY --chown=101:101 app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=builder /workspace/app/dist /usr/share/nginx/html

USER 101:101
ENTRYPOINT []

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
