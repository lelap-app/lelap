# The catalog service on Node, for self-hosting. Built from the repository root:
#   docker build -f docker/catalog.Dockerfile .
# Built once on the runner's own CPU: the output is one JavaScript file, the same for every platform.
FROM --platform=$BUILDPLATFORM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5 AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@lelap/docker-server..." \
  && pnpm --filter @lelap/docker-server build

FROM node:26-alpine@sha256:6bd9ab43c0ec0190ca7b2d193906cb8b7edf6e7f4afa43ddeccd6452710bffb5
WORKDIR /app
COPY --from=build /src/docker/server/dist/catalog.mjs ./server.mjs
RUN mkdir /secrets && chown node:node /secrets
VOLUME /secrets
ENV PORT=8787 NODE_ENV=production
EXPOSE 8787 9787
# The admin page's port (docker/README.md): /health for this check, the rest behind ADMIN_TOKEN.
# Secrets made on first start (ADMIN_TOKEN, CONFIG_SECRET) are kept in /secrets.
ENV ADMIN_PORT=9787 SECRETS_DIR=/secrets
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.ADMIN_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
USER node
CMD ["node", "server.mjs"]
