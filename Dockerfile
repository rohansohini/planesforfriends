# Planes for Friends has no dependencies, so this is deliberately tiny.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=3000 \
    PFF_DATA_DIR=/data

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public
COPY scripts ./scripts

# The SQLite file lives on a mounted volume, never in the image layer.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
