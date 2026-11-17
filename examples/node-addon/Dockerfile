# No dependencies, so no install step.
FROM node:24-alpine
WORKDIR /app
COPY addon.mjs server.mjs ./
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
