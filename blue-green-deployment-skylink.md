# Blue-Green Deployment Guide — SkyLink Networks

## Overview

This document describes the zero-downtime deployment system used for the `app` (billing/API backend) and `redirect` (MikroTik captive-portal redirect) services on the SkyLink Networks VPS.

The core idea: **never let there be a moment with zero healthy containers for a service.** A new container is started, built from the latest code, and confirmed healthy *before* the old container is removed. For a brief overlap window, both old and new containers run simultaneously and both can legitimately receive traffic — then the old one is retired once the new one has proven itself.

This eliminates the downtime that comes from the simpler "stop old, then start new" deploy pattern, where there's an unavoidable gap between the old container disappearing and the new one becoming ready to serve requests.

---

## The mechanism: DNS-based traffic discovery

The entire system works because of how Nginx is configured to find the `app` and `redirect` containers.

```nginx
http {
    resolver 127.0.0.11 valid=10s;
    ...
    location /api/ {
        set $backend "app:5000";
        proxy_pass http://$backend;
        ...
    }
}
```

Two details make this work:

1. **`resolver 127.0.0.11 valid=10s;`** — `127.0.0.11` is Docker's embedded DNS server, reachable from inside any container on a Docker network. This line tells Nginx to use that DNS server for hostname lookups, and to cache each result for at most 10 seconds before looking it up again.

2. **`proxy_pass http://$backend;` with `$backend` set via a `set` directive** — because the destination is a *variable* rather than a literal string, Nginx is forced to re-resolve it through the configured `resolver` on a rolling basis, instead of resolving it once when Nginx starts and caching that result indefinitely.

Docker's embedded DNS has a property that makes this useful: if **multiple containers** are attached to the same network and registered under the same service name, a DNS lookup for that name returns **all of their IP addresses**, and clients (including Nginx) round-robin between them.

So during a deploy, if both the old `app` container and a new `app` container are temporarily running side by side, Nginx's repeated DNS lookups will simply start returning both IPs — traffic gets split across old and new automatically. No Nginx configuration changes, no reload, and no manual tracking of "which one is live right now" are needed. The same `set $backend` / `proxy_pass $backend` pattern is used for the `redirect` service's Nginx blocks (both HTTP and HTTPS) for the same reason.

`proxy_next_upstream` is also configured on both routes, so if a request happens to hit a container that's mid-shutdown and fails, Nginx automatically retries it against the other one:

```nginx
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 3;
proxy_next_upstream_timeout 30s;
```

---

## Supporting infrastructure changes

A few pieces of the stack had to be adjusted to make two containers per service actually possible.

### Port ranges instead of fixed ports

```yaml
# app
ports:
  - "127.0.0.1:5000-5001:5000"
# redirect
ports:
  - "127.0.0.1:8081-8082:8081"
```

Two containers of the same service cannot both bind the same host port. A port *range* lets Docker assign whichever port in the range is currently free — normally the first container holds the lower port, and a second, temporary container during a deploy takes the next one up, with no collision. Nginx itself never uses these host ports — it talks to containers over the internal Docker network by service name — so this exists purely to preserve the ability to `curl localhost:5000/health` directly on the VPS for manual debugging.

### No fixed `container_name`

`app` and `redirect` no longer have a hardcoded `container_name:` in `docker-compose.yml`. Scaling a service to multiple replicas requires Compose to generate a unique name per container (e.g. `isp-app-1`, `isp-app-2`, climbing with each deploy) — a fixed name forces every replica to collide on the same name, which Compose refuses outright.

This means **any script or process that referred to the old fixed container names directly must instead use the Docker Compose *service* name** (`app`, `redirect`), which is always a stable DNS alias on the network regardless of what the actual container ends up being called. Two FreeRADIUS exec scripts (`activate_customer.sh`, `disconnect_hotspot.sh`) that previously called `http://isp-backend:5000` directly were updated to call `http://app:5000` instead, for exactly this reason. Logging and inspection commands follow the same rule — `docker compose logs app` (by service) rather than `docker logs isp-backend` (by container name), since the latter will silently stop matching anything after the first deploy.

### Migration discipline

Blue-green's overlap window means old code and new code may both serve requests for a few seconds against the same database. This is safe for the vast majority of changes, but not for a migration the *old* code can't tolerate (a dropped or renamed column, a changed type).

In practice:
- **MongoDB** changes are additive by nature — new code simply starts reading/writing new fields, and old code ignores fields it doesn't know about. No separate migration step exists or is needed.
- **MySQL** changes are applied **manually, as a deliberate step, before** the corresponding code is pushed — entirely decoupled from the automated deploy pipeline. As long as a schema change doesn't break the *currently running* (soon-to-be-old) code's queries, it's safe to alter ahead of time and push the matching code afterward.

---

## The deploy script: `bluegreen-deploy.sh`

This script lives on the VPS at `~/isp/bluegreen-deploy.sh` and is hand-maintained there — it is intentionally **not** tracked in the application's git repository, so that ordinary code deploys never touch or overwrite it.

For a given service (`app` or `redirect`), it performs the following steps in order:

1. **Record the ID of the currently running container.** This is the only reliable way to identify the "old" container later — Compose's auto-generated names increment indefinitely and aren't safe to reason about by number alone.
2. **Build the new image.**
3. **Scale the service to 2 containers** using `docker compose up -d --no-deps --scale <service>=2 --no-recreate <service>`. The `--no-recreate` flag is essential: without it, Compose may treat the existing container as "changed" (since the image was just rebuilt) and recreate it too — killing the old container before the new one is ready, which would defeat the entire mechanism.
4. **Identify the new container** by comparing the current container list against the ID recorded in step 1.
5. **Discover which host port the new container landed on**, via `docker port`, since the port range means it isn't guaranteed to be a specific number.
6. **Health-check the new container directly**, polling its `/health` endpoint for up to 60 seconds (12 retries at 5-second intervals).
7. **Branch on the result:**
   - If healthy: stop and remove the *old* container by its recorded ID. Exactly one container remains, running the new code.
   - If unhealthy: remove the *new* container instead. The old container was never touched and was serving traffic the entire time. The script exits non-zero so CI reports the failure.
8. **Settle the replica count back to 1** as a self-healing safety net, regardless of which branch was taken.

### Usage

```bash
cd ~/isp
./bluegreen-deploy.sh app
./bluegreen-deploy.sh redirect
```

---

## CI/CD integration

The GitHub Actions workflow copies the repository to the VPS, then delegates the actual build-and-swap logic to the VPS-resident script rather than running `docker compose build` / `docker compose up` inline:

```yaml
- name: Copy files to VPS
  uses: appleboy/scp-action@v0.1.7
  with:
    source: "."
    target: "~/isp/ISP_BACKEND"

- name: Blue-Green deploy app
  id: deploy_app
  continue-on-error: true
  uses: appleboy/ssh-action@v1.0.3
  with:
    script: |
      cd ~/isp
      ./bluegreen-deploy.sh app

- name: Blue-Green deploy redirect
  id: deploy_redirect
  continue-on-error: true
  uses: appleboy/ssh-action@v1.0.3
  with:
    script: |
      cd ~/isp
      ./bluegreen-deploy.sh redirect

- name: Fail workflow if either deploy failed
  if: steps.deploy_app.outcome == 'failure' || steps.deploy_redirect.outcome == 'failure'
  run: exit 1
```

Key points:

- **`continue-on-error: true`** on both deploy steps, combined with an explicit check of both outcomes afterward, means `app` and `redirect` deploy **independently**. If one fails its health check and rolls back, the other still proceeds with its own zero-downtime swap, and logs for both are always printed regardless of outcome.
- **No separate post-deploy health verification step is needed** — the blue-green script already gates the container swap on a passing health check internally; checking again afterward would be redundant.
- **No Nginx reload step is needed** — there is no Nginx configuration change during a deploy. The DNS-resolution mechanism means Nginx discovers the second container on its own, continuously, via the `resolver` directive already in place.
- Telegram notifications report success/failure per the existing pattern, with failure messages clarifying that a rollback means the *old* containers were left running and untouched throughout — users should not have noticed anything.

---

## Verification performed

Both the success path and the failure/rollback path were tested directly on the live VPS before relying on this in production:

- **Success path:** A real deploy was run for both `app` and `redirect`. `docker compose ps` confirmed exactly one container remained per service afterward, and a fresh `curl .../health` call confirmed the new code was live and responding correctly.
- **Failure path:** A deliberate, temporary `process.exit(1)` was inserted at the very top of `server.js`'s startup sequence, then reverted immediately after the test. With that change in place, `./bluegreen-deploy.sh app` was run: the new container started, crashed instantly, and could never pass its healthcheck. The script correctly waited out the full 60-second budget, then removed only the broken container, leaving the original container's uptime and health status completely unaffected throughout — confirmed via `docker compose ps` and a live `/health` check immediately afterward.

---

## Quick reference

| File | Location | Tracked in git? |
|---|---|---|
| `bluegreen-deploy.sh` | `~/isp/bluegreen-deploy.sh` | No — VPS-only, hand-maintained |
| `nginx.conf` | `~/isp/nginx.conf` | No — VPS-only, hand-maintained |
| `docker-compose.yml` | `~/isp/docker-compose.yml` | No — VPS-only, hand-maintained |
| `activate_customer.sh` / `disconnect_hotspot.sh` | `~/isp/freeradius/scripts/` | No — VPS-only, hand-maintained |
| GitHub Actions workflow | `isp-backend` repo, `.github/workflows/` | Yes |
| Application code (`server.js`, etc.) | `isp-backend` repo | Yes |

To check which host port a service's container currently holds (useful since the port range means it isn't always the same number):

```bash
docker compose port app 5000
docker compose port redirect 8081
```

To view logs by service (reliable regardless of the container's actual auto-generated name):

```bash
docker compose logs app --tail 30
docker compose logs redirect --tail 30
```








non-related

# import the certificates
/certificate import file-name=ca.crt passphrase=""
/certificate import file-name=client-officemik.crt passphrase=""
/certificate import file-name=client-officemik.key passphrase=""

# set up ovpn client
/interface ovpn-client add name=skylink-vpn connect-to=102.210.40.178 port=1194 mode=ip user=client-officemik certificate=client-officemik.crt_0 cipher=aes128 add-default-route=no disabled=no

# check connection status
/interface ovpn-client monitor 0

# check tunnel ip assigned
/ip address print

# point radius to the vpn tunnel
/radius remove [find]
/radius add address=10.8.0.1 secret=kWC1Yo88na22ffDG5L6O2GjvBVx1kFZ0 src-address=10.8.0.6 service=ppp,hotspot,login timeout=3000 authentication-port=1812 accounting-port=1813

# enable radius for pppoe
/ppp aaa set use-radius=yes

# enable radius for hotspot
/ip hotspot profile set [find] use-radius=yes

# verify radius config
/radius print