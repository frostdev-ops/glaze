# Run a Glaze share relay

The relay stores signed, end-to-end encrypted sessions and files and tells open Glaze surfaces when to catch up. It uses Node built-ins only. There are no accounts, analytics or server-side decryption keys. Select your server in **Share sessions → Relay**; that setting applies only to new sessions. Existing invites and device keys keep their original server, including its port. Moving a server to another origin requires a new session/invite, not a changed setting.

The public interface is `server/relay.js` and `lib/sharing.js`. The relay sees random session/file IDs, public verification keys, signatures, batch numbers, padded sizes, timing, the expiry choice and a hash of the creator's delete token. It sees the raw delete token when a creator deletes a session or changes expiry. It cannot read content, titles, filenames, device names or encryption keys. A TLS-terminating proxy sees the same wire data; the network sees addresses, timing and sizes. A bucket sees encrypted objects and relay requests. An operator can deny service, withhold data or keep old ciphertext/backups; Glaze cannot vouch for a custom operator.

Invite keys are in the fragment after `#`, which is not sent in HTTP requests. Prefer pasting invites into Glaze. The relay's `/j` landing page runs no scripts; opening it can retain the key in browser history. Do not add analytics, third-party scripts or redirects to it. Key-bearing backups and full invites stay private.

## Plain Node

Use Node **22.13 or later** with `node:sqlite` available (the supplied image uses Node 24). From this repository:

```sh
install -d -m 700 /var/lib/glaze-relay
HOST=127.0.0.1 PORT=8787 DB=/var/lib/glaze-relay/share.db \
  BLOBS=/var/lib/glaze-relay/blobs IP_HEADER=x-real-ip \
  TRUSTED_PROXIES=127.0.0.1/32,::1/128 node server/relay.js
```

Run as an unprivileged service user with write access only to its data directory, under your service manager with restart-on-failure and graceful SIGTERM. Keep port 8787 reachable only by the TLS proxy. On your own computer, `http://localhost:8787` or `http://127.0.0.1:8787` can be used for self-testing. Public origins must use HTTPS; the extension refuses paths, credentials, queries and fragments in the relay setting. HTTP connection tests and session requests omit browser credentials, send no referrer and refuse redirects, so configure the final HTTPS origin directly. Live updates retain the browser's native WebSocket behavior.

## Docker

The supplied Dockerfile runs as `node`, stores the database and default disk blobs under `/data`, and listens on loopback. On a Linux host with host networking:

```sh
docker build -t glaze-relay server
docker run -d --name glaze-relay --restart unless-stopped --network host \
  -e HOST=127.0.0.1 -e TRUSTED_PROXIES=127.0.0.1/32,::1/128 \
  -v glaze-share:/data glaze-relay
```

For R2, add `--env-file /etc/glaze-relay.env` before the image name. Keep that file owned by the service administrator with mode 600; never put it in this repository or the extension. Host networking here means Linux host networking; do not assume Docker Desktop has the same peer address behavior. A bridge setup must bind/publish only to loopback, use `HOST=0.0.0.0` inside the container, and trust only the exact peer address the proxy presents. Verify that address before enabling forwarded-IP trust; never trust a shared container subnet.

## TLS proxy and client addresses

The boundary: the public edge accepts requests, the local proxy overwrites `X-Real-IP`, and the relay reads it only from `TRUSTED_PROXIES`. The relay's default trusted peers are `127.0.0.1/8,::1/128`; use the narrower addresses above when possible. `IP_HEADER` alone does not trust arbitrary peers. Its value must be a valid IP; for a comma-separated header the relay takes the **last** entry. Never pass an untrusted client-supplied value or a blindly appended forwarding chain. Client IPs are used in memory for rate limiting (IPv6 by /64), not relay access logs.

These are operator examples, not a capture of the deployed configuration. The repository records nginx/Cloudflare deployment but contains no deployed nginx configuration. Verify certificate paths, trusted edge addresses, peer addresses and real-IP spoof resistance on your installation.

Directly exposed **Caddy**, terminating public TLS itself:

```caddyfile
relay.example.edu {
  reverse_proxy 127.0.0.1:8787 {
    header_up X-Real-IP {remote_host}
  }
}
```

If Caddy is behind Cloudflare, use S6's trust model: configure `servers { trusted_proxies static <current Cloudflare CIDRs>; client_ip_headers CF-Connecting-IP }` in the global options block, and forward `X-Real-IP {client_ip}`. Substitute actual CIDRs from the edge provider; the placeholder is not a valid config. Restrict origin access to that edge and use strict TLS verification between edge and origin. Do not trust every inbound `CF-Connecting-IP`. Leave Caddy access logging off unless your own disclosed policy requires it. Caddy proxies WebSocket upgrades automatically.

Directly exposed **nginx**, terminating public TLS itself (`map` belongs in the `http` context):

```nginx
map $http_upgrade $glaze_connection {
  default upgrade;
  '' close;
}
server {
  listen 443 ssl;
  server_name relay.example.edu;
  ssl_certificate /etc/nginx/tls/relay.pem;
  ssl_certificate_key /etc/nginx/tls/relay-key.pem;
  access_log off;
  client_max_body_size 24m;
  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $glaze_connection;
    proxy_buffering off;
    proxy_read_timeout 90s;
  }
}
```

Behind Cloudflare, add one `set_real_ip_from <CIDR>;` for each current trusted edge range and `real_ip_header CF-Connecting-IP;`, with origin network access restricted to the edge. Then `$remote_addr` is the verified client address that nginx overwrites into `X-Real-IP`. Do not replace it with `$http_x_real_ip` or an unvalidated `X-Forwarded-For`. Use TLS Full (strict) or the equivalent and disable caching, challenge pages and bot interstitials for the relay. Enable WebSockets. Keep the relay's `no-store` responses; a health request must return JSON, not a login/challenge/redirect page. Error logs may contain request metadata: choose and disclose your retention policy separately.

Before use, verify that requests from two networks are rate-limited separately and that forged client-IP headers cannot change the limiter's identity. Proxy examples and Docker builds have not been exercised by E1; deployment-specific verification belongs to the operator.

## File storage and environment

SQLite always stores session metadata and encrypted batches. Files use local disk unless **all four** R2 variables are set. Partial R2 configuration falls back to disk, so check the complete service environment before starting.

| Variable | Default / meaning |
|---|---|
| `HOST`, `PORT` | `127.0.0.1`, `8787` |
| `DB` | `share.db`; Docker: `/data/share.db` |
| `BLOBS` | `share-blobs`; Docker: `/data/blobs`; unused when all R2 variables are supplied |
| `IP_HEADER` | Empty (peer IP only); Docker: `x-real-ip` |
| `TRUSTED_PROXIES` | `127.0.0.1/8,::1/128`; comma-separated IPs/CIDRs allowed to supply `IP_HEADER` |
| `MAX_BYTES` | `5368709120` (5 GiB of stored encrypted log bytes) |
| `MAX_BLOB_BYTES` | `21474836480` (20 GiB of stored encrypted file bytes) |
| `MAX_SESSIONS` | `500000`, including deleted-session tombstones |
| `R2_ACCOUNT_ID` | Cloudflare account used to derive the R2 endpoint |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Scoped server-only bucket credentials |
| `R2_BUCKET` | Bucket name; all four `R2_*` values are required to select R2 |

The CLI supports local disk or Cloudflare R2. The exported `s3Store({endpoint,bucket,keyId,secret,region})` is an S3-compatible adapter; selecting another provider requires your own small server entry point using that public API. There is no generic `S3_ENDPOINT` environment variable. Keep credentials restricted to the relay's bucket and required object read/write/delete operations. The relay does not need bucket listing. Do not switch stores on an existing database without migrating all referenced encrypted objects.

Current fixed limits in the public server interface: 4 MiB per encrypted batch, 50 MiB log per session, `(20 MiB + 4096 + 28)` bytes per file, 500 MiB files per session, `5600000 + 4096` bytes per JSON request body, 4 MiB catch-up page, 200 sessions per socket, eight sockets per client address. Per-address token buckets allow bursts of 30 creates/hour, 240 writes/minute, 600 reads/minute, 500 MiB uploads/hour and 2 GiB downloads/hour. These are constructor constants/options, not additional CLI environment switches. The extension's own lower limits still apply (20 sessions, 200 selected items, 16 MiB state, 64 MiB session files and 200 MiB retained files/device).

Byte limits count payloads, not the physical volume: leave room for SQLite overhead, WAL, tombstones and backups. The relay has one serving lease per database; do not start independent replicas against copies of that database or assume active-active operation. Sessions persist until creator deletion unless their creator opts into expiry after 365 unused days. Deleting a session removes its current stored data/files, not device copies or older backups. Deleting an individual shared item can leave encrypted history/files until compaction or session deletion.

## Back up and restore

The CLI's SQLite online backup is safe beside a serving relay and leaves in-flight uploads alone:

```sh
DB=/var/lib/glaze-relay/share.db node server/relay.js --backup /backups/glaze-share.db
docker exec glaze-relay node relay.js --backup /data/backup.db
```

Choose the applicable command. Copy backups off the server, restrict access and set a disclosed retention period (S6 proposed nightly copies retained 14 days). This backup includes **only the database**, never disk blobs or R2 objects. Back up the blob directory or bucket separately. For a consistent disk database/blob recovery point, stop the service while taking the database backup and copying the blob tree. The online database copy alone is consistent as a database, but concurrent file deletion/upload means an independently timed blob copy need not match it.

To restore, stop the serving relay, preserve the current data for rollback, restore the database backup to `DB`, and remove the old database's `-wal`/`-shm` companions while stopped. Restore its matching disk blobs or object backup, with the same paths/store configuration and ownership. Start exactly one relay. The backup command removes its copied serving lease, allowing prompt restart. Verify `/health` and a disposable encrypted share before allowing normal traffic.

Devices can resend encrypted batches after an older database restore. Files deleted since a database-only backup may be missing, and later objects can be untracked. **Re-upload retained files** in the extension republishes encrypted files this device still holds; it cannot recreate bytes missing everywhere. Backups can retain data the creator has since deleted, so explain that retention to users. To administratively delete a known session, `DB=… node server/relay.js --delete <session-id>` removes its data and files using the configured store; it must use the same complete environment as the service. Do not invent or publish IDs from logs.

## Update

Keep your current code/image and environment, take database and file backups, then stop the service gracefully. Review changes to the public protocol/schema and start the new version against the retained data with the same final HTTPS origin. Check `/health`, create/join with a disposable local test share, encrypted file read-back and deletion, and verify that existing clients catch up. Roll back code with its compatible saved database/files if needed; do not run older code against an incompatible migrated database. E1 does not deploy or certify an operator's proxy, storage, backups or update process.
