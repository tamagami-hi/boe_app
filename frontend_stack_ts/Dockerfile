FROM node:22.23.2-alpine3.24@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS deps

WORKDIR /workspace

COPY packages/contracts/package.json packages/contracts/package-lock.json ./packages/contracts/
RUN npm --prefix packages/contracts ci

COPY packages/contracts ./packages/contracts
RUN npm --prefix packages/contracts run build

COPY frontend_stack_ts/package.json frontend_stack_ts/package-lock.json ./frontend_stack_ts/
RUN npm --prefix frontend_stack_ts ci

FROM deps AS builder

WORKDIR /workspace

ARG VITE_BEO_API_BASE_URL
ARG VITE_BEO_APP_TARGET=client
ENV VITE_BEO_API_BASE_URL=${VITE_BEO_API_BASE_URL}
ENV VITE_BEO_APP_TARGET=${VITE_BEO_APP_TARGET}
ENV VITE_BEO_API_MODE=http

COPY frontend_stack_ts ./frontend_stack_ts
RUN npm --prefix frontend_stack_ts run build

FROM nginxinc/nginx-unprivileged:1.31.1-alpine3.23-slim@sha256:762e8e4e5e103817c4158400fc3753c8e713ff8153b8c3afbb458ae4572bc9a3 AS runtime

COPY --chown=101:101 frontend_stack_ts/nginx.conf /etc/nginx/conf.d/default.conf
COPY --chown=101:101 --from=builder /workspace/frontend_stack_ts/dist /usr/share/nginx/html

USER 101:101
ENTRYPOINT []

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
