# The web app (listen.<domain>) as static files behind Caddy. Built from the repository root:
#   docker build -f docker/web.Dockerfile --build-arg LELAP_DOMAIN=example.org .
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build
ARG LELAP_DOMAIN=lelap.app
WORKDIR /src
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter "@lelap/app..." \
  && EXPO_PUBLIC_LELAP_DOMAIN=$LELAP_DOMAIN pnpm --filter @lelap/app build

FROM caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/apps/app/dist-web /srv
EXPOSE 8080
