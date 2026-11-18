# Step 3 in a container, next to your files. Build it in your own copy of the guide's add-on, where
# `npm install @lelap/sdk` wrote package-lock.json; this folder links the SDK from the repository.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY *.mjs ./
USER node
ENV PORT=8787 BOOKS_FOLDER=/books
EXPOSE 8787
CMD ["node", "server.mjs", "source"]
