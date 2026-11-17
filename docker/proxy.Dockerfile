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


ENV PORT=8788 NODE_ENV=production
EXPOSE 8788
USER node
CMD ["node", "server.mjs"]
