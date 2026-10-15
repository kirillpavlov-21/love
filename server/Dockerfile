# «Куда идём?» API на своём сервере: Node 22 + SQLite в томе /data
#   docker build -t kuda-api server/
#   docker run -d --name kuda-api --restart unless-stopped -p 127.0.0.1:8787:8787 -v kuda-data:/data \
#     -e ALLOWED_ORIGINS=https://твой-сайт.ru -e SITE_ORIGINS=https://твой-сайт.ru -e ADMIN_TOKEN=… -e TRUST_PROXY=1 kuda-api
FROM node:22-alpine

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    STORE=sqlite \
    SQLITE_PATH=/data/kuda.db

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY handler.mjs server.mjs ./
COPY lib ./lib
COPY store ./store

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/ >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]
