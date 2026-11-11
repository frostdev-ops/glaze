# Glaze share relay. Build, then run it on the host's network listening on 127.0.0.1 only, behind a TLS reverse proxy
# on the same host that puts the client's address in X-Real-IP. The proxy then reaches the relay from 127.0.0.1, the
# only peer whose X-Real-IP counts (TRUSTED_PROXIES' default). R2's credentials come from a file the owner keeps on the
# server, never in this repository:
#   docker build -t glaze-relay server
#   docker run -d --name glaze-relay --restart unless-stopped --network host -e HOST=127.0.0.1 -v glaze-share:/data \
#     --env-file /etc/glaze-relay.env glaze-relay
# /etc/glaze-relay.env (mode 600): R2_ACCOUNT_ID=…, R2_ACCESS_KEY_ID=…, R2_SECRET_ACCESS_KEY=…, R2_BUCKET=glaze-share.
# Without it, files go to /data/blobs. Backup: docker exec glaze-relay node relay.js --backup /data/backup.db
# On a bridge network instead, the proxy's address inside the container is the bridge gateway: set TRUSTED_PROXIES to
# exactly that address, never to a whole range other containers share.
# Node 26, the major CI tests on, pinned by digest: a moved tag can't change what runs on the server. Resolved 2026-11-11
# (node 26.13.0, linux/amd64 and arm64). To move the pin, run `docker buildx imagetools inspect node:26-alpine`, put its
# Digest after the @, and run the relay's tests (test/sharing) on that Node first.
FROM node:26-alpine@sha256:8996bb5821d62a8fd9bb27c1cb07462f3fdce6e47d640c6a881ead0b064ce216
WORKDIR /app
COPY relay.js .
RUN mkdir /data && chown node /data
USER node
ENV HOST=127.0.0.1 PORT=8787 DB=/data/share.db BLOBS=/data/blobs IP_HEADER=x-real-ip NODE_OPTIONS=--disable-warning=ExperimentalWarning
EXPOSE 8787
VOLUME /data
# The relay's own /health on HOST (loopback for a wildcard bind); a relay that lost its lease answers 503.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const h=process.env.HOST||'127.0.0.1'; const host=h==='0.0.0.0'?'127.0.0.1':h==='::'?'[::1]':h.includes(':')?'['+h+']':h; fetch('http://'+host+':'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "relay.js"]
