# The updates service (over-the-air app bundles) on Node, for self-hosting. Serves what
# `scripts/ota.mts` writes, from the /data volume. Built from the repository root:
#   docker build -f docker/updates.Dockerfile .
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@lelap/docker-server..." \
  && pnpm --filter @lelap/docker-server build

FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5
WORKDIR /app
COPY --from=build /src/docker/server/dist/updates.mjs ./server.mjs
RUN mkdir /data && chown node:node /data
VOLUME /data
ENV PORT=8790 UPDATES_DIR=/data NODE_ENV=production
EXPOSE 8790
USER node
CMD ["node", "server.mjs"]
