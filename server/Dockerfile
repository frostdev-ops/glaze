# Glaze share relay. Build and run (publish on 127.0.0.1 only, behind a TLS reverse proxy that sets X-Forwarded-For):
#   docker build -t glaze-relay server
#   docker run -d --name glaze-relay --restart unless-stopped -p 127.0.0.1:8787:8787 -v glaze-share:/data glaze-relay
# Backup: docker exec glaze-relay node --disable-warning=ExperimentalWarning relay.js --backup /data/backup.db
FROM node:24-alpine
WORKDIR /app
COPY relay.js .
RUN mkdir /data && chown node /data
USER node
ENV HOST=0.0.0.0 PORT=8787 DB=/data/share.db TRUST_PROXY=1
EXPOSE 8787
VOLUME /data
CMD ["node", "--disable-warning=ExperimentalWarning", "relay.js"]
