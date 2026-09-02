# Team server image: serves the API and the built web UI on port 4000.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY desktop/package.json desktop/
RUN npm ci --workspace server --workspace client --ignore-scripts
COPY server server
COPY client client
RUN npm run build -w client

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=4000 MAILMAN_DB=/data/mailman.db
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
COPY desktop/package.json desktop/
RUN npm ci --workspace server --omit=dev --ignore-scripts && npm cache clean --force
COPY server server
COPY --from=build /app/client/dist client/dist
VOLUME /data
EXPOSE 4000
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.js"]
