# Glaze share relay. Build and run, published on 127.0.0.1 only, behind a TLS reverse proxy that puts the client's
# address in X-Real-IP. R2's credentials come from a file the owner keeps on the server (never in this repository):
#   docker build -t glaze-relay server
#   docker run -d --name glaze-relay --restart unless-stopped -p 127.0.0.1:8787:8787 -v glaze-share:/data \
#     --env-file /etc/glaze-relay.env glaze-relay
# /etc/glaze-relay.env (mode 600): R2_ACCOUNT_ID=…, R2_ACCESS_KEY_ID=…, R2_SECRET_ACCESS_KEY=…, R2_BUCKET=glaze-share.
# Without it, files go to /data/blobs. Backup: docker exec glaze-relay node relay.js --backup /data/backup.db
FROM node:24-alpine
WORKDIR /app
COPY relay.js .
RUN mkdir /data && chown node /data
USER node
ENV HOST=0.0.0.0 PORT=8787 DB=/data/share.db BLOBS=/data/blobs IP_HEADER=x-real-ip NODE_OPTIONS=--disable-warning=ExperimentalWarning
EXPOSE 8787
VOLUME /data
CMD ["node", "relay.js"]
