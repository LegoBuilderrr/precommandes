# Pré-commandes L'ELEFAN : Node 22 (module node:sqlite), aucune dépendance npm.
FROM node:22-alpine

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public

# Derrière un proxy (Apache, nginx...) qui fait le TLS : http simple sur le port 3000.
# La base et les images téléversées vivent dans le volume /data.
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    PLAIN_HTTP=1 \
    DB_FILE=/data/data.db \
    UPLOAD_DIR=/data/uploads
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/ || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
