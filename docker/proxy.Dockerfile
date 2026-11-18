# The proxy service on Node, for self-hosting. Built from the repository root:
#   docker build -f docker/proxy.Dockerfile .
# Built once on the runner's own CPU: the output is one JavaScript file, the same for every platform.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@lelap/docker-server..." \
  && pnpm --filter @lelap/docker-server build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
COPY --from=build /src/docker/server/dist/proxy.mjs ./server.mjs
RUN mkdir /secrets && chown node:node /secrets
VOLUME /secrets
ENV PORT=8788 NODE_ENV=production
EXPOSE 8788 9788
# The admin page's port (docker/README.md): /health for this check, the rest behind ADMIN_TOKEN.
# Secrets made on first start (ADMIN_TOKEN, CONFIG_SECRET) are kept in /secrets.
ENV ADMIN_PORT=9788 SECRETS_DIR=/secrets
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.ADMIN_PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
USER node
CMD ["node", "server.mjs"]
