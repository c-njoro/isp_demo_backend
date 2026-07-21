# Blue-Green Zero-Downtime Deployment Guide

> A complete guide to implementing automated blue-green deployments for Node.js apps running in Docker behind Nginx, with GitHub Actions CI/CD.

---

## Table of Contents

1. [What is Blue-Green Deployment?](#1-what-is-blue-green-deployment)
2. [Prerequisites](#2-prerequisites)
3. [Architecture Overview](#3-architecture-overview)
4. [Port Allocation Strategy](#4-port-allocation-strategy)
5. [Server Setup](#5-server-setup)
6. [The Deploy Script](#6-the-deploy-script)
7. [Docker & Networking](#7-docker--networking)
8. [Nginx Configuration](#8-nginx-configuration)
9. [Application Requirements](#9-application-requirements)
10. [GitHub Actions Workflow](#10-github-actions-workflow)
11. [Initial Bootstrap](#11-initial-bootstrap)
12. [Known Gotchas](#12-known-gotchas)
13. [Troubleshooting](#13-troubleshooting)
14. [Quick Reference](#14-quick-reference)

---

## 1. What is Blue-Green Deployment?

Blue-green deployment eliminates downtime by maintaining two identical production environments, **blue** (currently live) and **green** (idle/staging). When you deploy:

1. New code is built into the idle slot
2. The new container starts and is health-checked for up to 60 seconds
3. If healthy, Nginx upstream is atomically swapped to the new container
4. The old container is gracefully drained and removed
5. If the health check fails, the old container is untouched users feel nothing

```
BEFORE DEPLOY          DURING DEPLOY          AFTER DEPLOY
─────────────          ─────────────          ────────────
Nginx → Blue(5000)     Nginx → Blue(5000)     Nginx → Green(5010)
                       Green(5010) starting   Blue stopped & removed
```

**Result:** Zero downtime. Automatic rollback on failure. No manual intervention required.

---

## 2. Prerequisites

### Server Requirements

| Requirement | Minimum | Notes |
|---|---|---|
| OS | Ubuntu 22.04+ | Tested on Ubuntu 24.04 LTS |
| RAM | 2GB | 4GB recommended for multiple apps |
| Docker | 24.0+ | `docker --version` |
| Docker Compose | v2.0+ | `docker compose version` |
| Nginx | 1.18+ | `nginx -v` |
| Bash | 5.0+ | `bash --version` |
| curl | Any | Used for health checks |

### Install Docker (Ubuntu)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

### Install Nginx

```bash
sudo apt update && sudo apt install nginx -y
```

### User Setup

Create a dedicated deploy user (do not deploy as root):

```bash
sudo useradd -m -s /bin/bash deployer
sudo usermod -aG docker deployer
```

### sudoers — Passwordless Nginx Reload

The deployer user needs to reload Nginx without a password prompt:

```bash
sudo visudo -f /etc/sudoers.d/deployer-nginx
```

Add:
```
deployer ALL=(ALL) NOPASSWD: /usr/bin/systemctl reload nginx, /usr/sbin/nginx, /bin/sed
```

Set correct permissions:
```bash
sudo chmod 0440 /etc/sudoers.d/deployer-nginx
sudo visudo -c -f /etc/sudoers.d/deployer-nginx
# Must print: parsed OK
```

---

## 3. Architecture Overview

```
Internet
   │
   ▼
Nginx (443/80)
   │
   ├── api.yourdomain.com ──────► Blue container (port 5000)  ◄── LIVE
   │                           or Green container (port 5010) ◄── LIVE (after swap)
   │
   └── support.yourdomain.com ──► Blue container (port 5001)  ◄── LIVE
                               or Green container (port 5011) ◄── LIVE (after swap)

Shared Docker Network (skylink-net)
   ├── mysql (skylink-mysql)
   ├── app-blue
   └── app-green
```

### Directory Structure

```
/opt/your-infra/
├── stack/
│   ├── docker-compose.yml      ← MySQL, frontends, other services
│   └── env/
│       ├── app1.env
│       └── app2.env
├── deploy/
│   ├── deploy.sh               ← Main blue-green deploy script
│   ├── state/                  ← Tracks active slot per app
│   │   ├── app1-api.slot       ← Contains "blue" or "green"
│   │   └── app2-api.slot
│   └── logs/
│       └── deploy.log          ← Timestamped deploy history
└── app-repo/                   ← Your git repository
    ├── app1/
    │   ├── server/
    │   └── client/
    └── app2/
        ├── server/
        └── client/
```

---

## 4. Port Allocation Strategy

Assign each app two ports (one for blue, one for green):

| App | Blue Port | Green Port | Internal Port |
|---|---|---|---|
| app1-api | 5000 | 5010 | 5000 |
| app2-api | 5001 | 5011 | 5001 |
| app1-frontend | 4173 | 4183 | 80 |
| app2-frontend | 4174 | 4184 | 80 |

**Rule:** Blue ports are the original ports your app ran on. Green ports are blue + 10.

---

## 5. Server Setup

### Create Directory Structure

```bash
sudo mkdir -p /opt/your-infra/deploy/state
sudo mkdir -p /opt/your-infra/deploy/logs
sudo chown -R deployer:deployer /opt/your-infra
```

### Create the Docker Network

All containers (including MySQL) must share one network for hostname resolution:

```bash
docker network create skylink-net
```

If MySQL is already running via docker-compose, connect it:

```bash
docker network connect skylink-net your-mysql-container
```

> ⚠️ **Critical:** Add `skylink-net` to your `docker-compose.yml` as an external network (see Section 7) so MySQL always joins it on restart.

---

## 6. The Deploy Script

Save this to `/opt/your-infra/deploy/deploy.sh` and make it executable:

```bash
chmod +x /opt/your-infra/deploy/deploy.sh
```

```bash
#!/usr/bin/env bash
# =============================================================
#  Blue-Green Deployer
#  Usage: ./deploy.sh <app> | --all
#  Apps:  app1-api | app2-api | app1-frontend | app2-frontend
# =============================================================

set -euo pipefail

DEPLOY_DIR="/opt/your-infra/deploy"
STATE_DIR="$DEPLOY_DIR/state"
LOG_FILE="$DEPLOY_DIR/logs/deploy.log"
NGINX_SITES="/etc/nginx/sites-available"
HEALTH_RETRIES=12      # 12 × 5s = 60s timeout
HEALTH_INTERVAL=5

mkdir -p "$STATE_DIR" "$DEPLOY_DIR/logs"

# Lookup functions (use case statements, NOT associative arrays)
# Associative arrays with hyphenated keys fail in some bash versions

blue_port() {
  case "$1" in
    app1-api)          echo 5000 ;;
    app2-api)          echo 5001 ;;
    app1-frontend)     echo 4173 ;;
    app2-frontend)     echo 4174 ;;
  esac
}

green_port() {
  case "$1" in
    app1-api)          echo 5010 ;;
    app2-api)          echo 5011 ;;
    app1-frontend)     echo 4183 ;;
    app2-frontend)     echo 4184 ;;
  esac
}

internal_port() {
  case "$1" in
    app1-api)          echo 5000 ;;
    app2-api)          echo 5001 ;;
    app1-frontend)     echo 80   ;;
    app2-frontend)     echo 80   ;;
  esac
}

build_ctx() {
  case "$1" in
    app1-api)          echo "/opt/your-infra/your-repo/app1/server" ;;
    app2-api)          echo "/opt/your-infra/your-repo/app2/server" ;;
    app1-frontend)     echo "/opt/your-infra/your-repo/app1/client" ;;
    app2-frontend)     echo "/opt/your-infra/your-repo/app2/client" ;;
  esac
}

image_name() {
  case "$1" in
    app1-api)          echo "yourorg/app1-api" ;;
    app2-api)          echo "yourorg/app2-api" ;;
    app1-frontend)     echo "yourorg/app1-frontend" ;;
    app2-frontend)     echo "yourorg/app2-frontend" ;;
  esac
}

nginx_conf() {
  case "$1" in
    app1-api)          echo "app1.conf" ;;
    app2-api)          echo "app2.conf" ;;
    app1-frontend)     echo "app1-client.conf" ;;
    app2-frontend)     echo "app2-client.conf" ;;
  esac
}

env_file() {
  case "$1" in
    app1-api)          echo "/opt/your-infra/stack/env/app1.env" ;;
    app2-api)          echo "/opt/your-infra/stack/env/app2.env" ;;
    app1-frontend)     echo "" ;;
    app2-frontend)     echo "" ;;
  esac
}

extra_flags() {
  case "$1" in
    app1-api)
      echo "--network skylink-net \
        -e DB_HOST=YOUR_MYSQL_IP \
        -v /opt/your-data/app1/uploads:/app/uploads \
        -v /opt/your-data/app1/logs:/app/logs"
      ;;
    app2-api)
      echo "--network skylink-net \
        -e DB_HOST=YOUR_MYSQL_IP \
        -v /opt/your-data/app2/uploads:/app/uploads \
        -v /opt/your-data/app2/logs:/app/logs"
      ;;
    app1-frontend)
      echo "--network skylink-net"
      ;;
    app2-frontend)
      echo "--network skylink-net"
      ;;
  esac
}

# Helpers

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

slot_file()      { echo "$STATE_DIR/$1.slot"; }
current_slot()   { local f; f=$(slot_file "$1"); [[ -f "$f" ]] && cat "$f" || echo "blue"; }
other_slot()     { [[ "$1" == "blue" ]] && echo "green" || echo "blue"; }
container_name() { echo "app-$1-$2"; }

port_for_slot() {
  local app=$1 slot=$2
  [[ "$slot" == "blue" ]] && blue_port "$app" || green_port "$app"
}

health_check() {
  local port=$1 app=$2 url

  if [[ "$app" == *frontend* ]]; then
    url="http://localhost:$port/"
  else
    url="http://localhost:$port/health"
  fi

  log "  Health checking $url ..."
  for i in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -sf --max-time 4 "$url" > /dev/null 2>&1; then
      log "  ✓ Healthy after $((i * HEALTH_INTERVAL))s"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

swap_nginx() {
  local app=$1 new_port=$2
  local conf="$NGINX_SITES/$(nginx_conf "$app")"

  log "  Swapping nginx upstream → port $new_port in $conf"
  sudo sed -i -E "s|(proxy_pass http://localhost:)[0-9]+;|\1${new_port};|g" "$conf"
  sudo nginx -t && sudo systemctl reload nginx
  log "  ✓ Nginx reloaded"
}

# Core deploy

deploy_app() {
  local app=$1
  local current new_slot new_port old_port old_container new_container

  current=$(current_slot "$app")
  new_slot=$(other_slot "$current")
  new_port=$(port_for_slot "$app" "$new_slot")
  old_port=$(port_for_slot "$app" "$current")
  old_container=$(container_name "$app" "$current")
  new_container=$(container_name "$app" "$new_slot")

  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log "Deploying [$app]  $current($old_port) → $new_slot($new_port)"
  log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 1. Build
  log "Building $(image_name "$app"):$new_slot ..."
  docker build \
    -t "$(image_name "$app"):$new_slot" \
    -t "$(image_name "$app"):latest" \
    "$(build_ctx "$app")"
  log "✓ Build complete"

  # 2. Remove stale slot container if exists
  if docker ps -a --format '{{.Names}}' | grep -q "^${new_container}$"; then
    log "Removing stale container $new_container ..."
    docker rm -f "$new_container"
  fi

  # 3. Start new container
  local ef; ef=$(env_file "$app")
  local env_flag=""
  [[ -n "$ef" ]] && env_flag="--env-file $ef"

  log "Starting $new_container on port $new_port ..."
  # shellcheck disable=SC2086
  docker run -d \
    --name "$new_container" \
    --restart always \
    -p "${new_port}:$(internal_port "$app")" \
    $env_flag \
    $(extra_flags "$app") \
    "$(image_name "$app"):$new_slot"

  # 4. Health check — rollback if fails
  if ! health_check "$new_port" "$app"; then
    log "✗ Health check FAILED — rolling back"
    docker rm -f "$new_container" || true
    log "  $old_container still serving on port $old_port — no downtime"
    return 1
  fi

  # 5. Swap nginx
  swap_nginx "$app" "$new_port"

  # 6. Save new active slot
  echo "$new_slot" > "$(slot_file "$app")"

  # 7. Gracefully stop old container
  log "Stopping old container $old_container (10s grace) ..."
  docker stop --timeout 10 "$old_container" 2>/dev/null || true
  docker rm "$old_container" 2>/dev/null || true

  log "✓ [$app] live → slot=$new_slot port=$new_port"
}

# Entry point

ALL_APPS=(app1-api app2-api app1-frontend app2-frontend)

case "${1:-}" in
  --all)
    for app in "${ALL_APPS[@]}"; do deploy_app "$app"; done
    ;;
  app1-api|app2-api|app1-frontend|app2-frontend)
    deploy_app "$1"
    ;;
  *)
    echo "Usage: $0 <app> | --all"
    echo "Apps:  ${ALL_APPS[*]}"
    exit 1
    ;;
esac

log "Done."
```

---

## 7. Docker & Networking

### docker-compose.yml

Add `skylink-net` as an external network so MySQL and other shared services are always reachable by blue/green containers:

```yaml
services:
  your-mysql:
    image: mysql:8
    container_name: your-mysql
    restart: always
    command: --mysql-native-password=ON   # Required for MySQL 8.4+
    environment:
      MYSQL_ROOT_PASSWORD: your_password
    ports:
      - "3306:3306"
    volumes:
      - mysql_data:/var/lib/mysql
    networks:
      - skylink-net

  your-frontend:
    build:
      context: /opt/your-infra/your-repo/app1/client
    container_name: your-frontend
    restart: always
    ports:
      - "4173:80"
    networks:
      - skylink-net

networks:
  skylink-net:
    external: true      # ← Must be external — created manually before compose up

volumes:
  mysql_data:
```

### Getting MySQL's IP for DB_HOST

Docker's embedded DNS can fail to resolve container hostnames in some configurations. Pass the IP directly as an environment variable override:

```bash
# Get MySQL's IP on skylink-net
docker inspect your-mysql --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
```

Use this IP in `extra_flags()` in your deploy script:
```bash
-e DB_HOST=172.20.0.4
```

> **Note:** This IP is stable as long as the compose stack stays up. It only changes if you do a full `docker compose down` and recreate. If MySQL's IP changes, update the deploy script and restart your app containers.

---

## 8. Nginx Configuration

Each app needs a config in `/etc/nginx/sites-available/`. The deploy script uses `sed` to rewrite the `proxy_pass` port on every deploy.

### API Config Example

```nginx
server {
    server_name api.yourdomain.com;

    # WebSocket support (if needed)
    location /socket.io/ {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://localhost:5000;   # ← This port is swapped by deploy.sh
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/api.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.yourdomain.com/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    if ($host = api.yourdomain.com) { return 301 https://$host$request_uri; }
    listen 80;
    server_name api.yourdomain.com;
    return 404;
}
```

> **Important:** The deploy script matches `proxy_pass http://localhost:PORT;` with a regex. Every `proxy_pass` in the config pointing to your app must use this exact format. Do not use upstream blocks.

### Enable the Config

```bash
sudo ln -s /etc/nginx/sites-available/app1.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## 9. Application Requirements

### Health Endpoint

Your Node.js API **must** expose a `/health` endpoint. The deploy script polls this before swapping Nginx. Without it, every deploy will fail the health check and roll back.

```js
// Add this BEFORE any other routes in your Express app
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

### Node.js DNS Fix (ES Modules)

If your app uses ES modules (`import` syntax) and connects to other containers by hostname, add this as the **absolute first line** of your database config file not your entry point, because ES module imports are hoisted and execute before any code in the entry file runs.

```js
// src/config/dbConnection.js — FIRST LINE
import { setDefaultResultOrder } from 'dns';
setDefaultResultOrder('ipv4first');

import mysql2 from 'mysql2/promise';
// ... rest of file
```

> **Why:** Node.js uses a DNS resolver by default that may not check `/etc/hosts`. Setting `ipv4first` forces it to use `getaddrinfo` which respects the hosts file and Docker's embedded DNS. This is required when containers resolve each other by name on a Docker network.

### Env File Hygiene

Env files must have no trailing tabs or spaces. These silently corrupt values at runtime.

```bash
# Check for hidden characters
cat -A your.env | grep -E "DB_"
# Every line must end with $ only — not ^I$ (tab) or spaces

# Fix all tabs in one shot
sed -i 's/\t//g' your.env
```

### MySQL 8.4 Authentication

MySQL 8.4 removed `mysql_native_password` entirely. If your app connects with a user that was created with this plugin, recreate it:

```bash
docker exec -it your-mysql mysql -u root -p'yourpassword' -e "
DROP USER IF EXISTS 'your_user'@'%';
CREATE USER 'your_user'@'%' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON your_db.* TO 'your_user'@'%';
FLUSH PRIVILEGES;
"
```

Also add to your MySQL service in docker-compose.yml:
```yaml
command: --mysql-native-password=ON
```

---

## 10. GitHub Actions Workflow

### How It Works

1. **detect-changes** — Uses `dorny/paths-filter` to diff changed file paths
2. **sync-code** — SSHes into server and runs `git pull` (always runs)
3. **deploy-\*** — Four parallel jobs, each gated by path filter only changed apps deploy
4. **cleanup** — Runs `docker image prune -f` after all jobs finish

```yaml
name: Deploy

on:
  push:
    branches:
      - main

jobs:
  detect-changes:
    runs-on: ubuntu-latest
    outputs:
      app1_api:          ${{ steps.filter.outputs.app1_api }}
      app1_frontend:     ${{ steps.filter.outputs.app1_frontend }}
      app2_api:          ${{ steps.filter.outputs.app2_api }}
      app2_frontend:     ${{ steps.filter.outputs.app2_frontend }}

    steps:
      - name: Checkout code
        uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Detect changed paths
        id: filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            app1_api:
              - 'app1/server/**'
            app1_frontend:
              - 'app1/client/**'
            app2_api:
              - 'app2/server/**'
            app2_frontend:
              - 'app2/client/**'

  sync-code:
    runs-on: ubuntu-latest
    needs: detect-changes
    steps:
      - name: Pull latest code on server
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: |
            cd /opt/your-infra/your-repo
            git pull origin main

  deploy-app1-api:
    runs-on: ubuntu-latest
    needs: [detect-changes, sync-code]
    if: needs.detect-changes.outputs.app1_api == 'true'
    steps:
      - name: Blue-Green deploy → app1-api
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: /opt/your-infra/deploy/deploy.sh app1-api

  deploy-app1-frontend:
    runs-on: ubuntu-latest
    needs: [detect-changes, sync-code]
    if: needs.detect-changes.outputs.app1_frontend == 'true'
    steps:
      - name: Blue-Green deploy → app1-frontend
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: /opt/your-infra/deploy/deploy.sh app1-frontend

  deploy-app2-api:
    runs-on: ubuntu-latest
    needs: [detect-changes, sync-code]
    if: needs.detect-changes.outputs.app2_api == 'true'
    steps:
      - name: Blue-Green deploy → app2-api
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: /opt/your-infra/deploy/deploy.sh app2-api

  deploy-app2-frontend:
    runs-on: ubuntu-latest
    needs: [detect-changes, sync-code]
    if: needs.detect-changes.outputs.app2_frontend == 'true'
    steps:
      - name: Blue-Green deploy → app2-frontend
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: /opt/your-infra/deploy/deploy.sh app2-frontend

  cleanup:
    runs-on: ubuntu-latest
    needs:
      - deploy-app1-api
      - deploy-app1-frontend
      - deploy-app2-api
      - deploy-app2-frontend
    if: always()
    steps:
      - name: Prune unused Docker images
        uses: appleboy/ssh-action@v1.1.0
        with:
          host: ${{ secrets.SERVER_HOST }}
          username: ${{ secrets.SERVER_USER }}
          key: ${{ secrets.SSH_PRIVATE_KEY }}
          script: docker image prune -f
```

### Required GitHub Secrets

| Secret | Value |
|---|---|
| `SERVER_HOST` | Your server's IP address |
| `SERVER_USER` | SSH username (e.g. `deployer`) |
| `SSH_PRIVATE_KEY` | Private key matching the server's `~/.ssh/authorized_keys` |

### Path Filters

The `dorny/paths-filter` action diffs against the **previous commit** (requires `fetch-depth: 2`). The paths are relative to your **repo root**, not the server path.

If your repo root is your app folder (i.e. the repo itself is `app1/`), the filters are:
```yaml
app1_api:
  - 'server/**'
```

If your repo contains multiple apps as subfolders:
```yaml
app1_api:
  - 'app1/server/**'
```

---

## 11. Initial Bootstrap

Run these steps once on a fresh server before your first deploy.

```bash
# 1. Create Docker network
docker network create skylink-net

# 2. Start your shared services (MySQL, etc.)
cd /opt/your-infra/stack
docker compose up -d

# 3. Connect MySQL to skylink-net (if not in compose yet)
docker network connect skylink-net your-mysql

# 4. Create deploy directories
mkdir -p /opt/your-infra/deploy/state
mkdir -p /opt/your-infra/deploy/logs

# 5. Initialize slot state — tells deploy.sh which slot is currently live
echo "blue" > /opt/your-infra/deploy/state/app1-api.slot
echo "blue" > /opt/your-infra/deploy/state/app2-api.slot
echo "blue" > /opt/your-infra/deploy/state/app1-frontend.slot
echo "blue" > /opt/your-infra/deploy/state/app2-frontend.slot

# 6. Rename existing containers to blue slot convention
docker rename your-app1    app-app1-api-blue
docker rename your-app2    app-app2-api-blue

# 7. Make deploy script executable
chmod +x /opt/your-infra/deploy/deploy.sh

# 8. Test manually before enabling CI/CD
/opt/your-infra/deploy/deploy.sh app1-api
```

---

## 12. Known Gotchas

### Bash Associative Arrays with Hyphenated Keys

`declare -A` with keys like `[app1-api]` is treated as arithmetic (`app1` minus `api`) in some bash versions, causing `unbound variable` errors. **Always use `case` statements** instead of associative arrays for app config lookups.

```bash
# ❌ WRONG — breaks with hyphenated keys
declare -A PORTS
PORTS=( [app1-api]=5000 )
echo "${PORTS[app1-api]}"   # Error: app1 - api = unbound variable

# ✅ CORRECT — always use case statements
port() {
  case "$1" in
    app1-api) echo 5000 ;;
  esac
}
```

### Docker DNS and ES Modules

Node.js ES modules hoist all `import` statements before any code runs. This means `setDefaultResultOrder('ipv4first')` in your entry file (`server.js`) executes **after** your database module has already been imported and initialized. Put the DNS fix in the database config file itself, as the very first line.

### Docker Layer Cache Serving Old Code

If you see a build finishing in under 2 seconds with all layers `CACHED`, Docker is serving old code. Force a fresh build:

```bash
docker build --no-cache -t yourimage:slot /path/to/context
```

The deploy script does not pass `--no-cache` by default for speed. Add it to `deploy.sh` if you need to guarantee fresh builds every time.

### Port Already Allocated

If a deploy fails with `Bind for 0.0.0.0:PORT failed: port is already allocated`, a container from a previous compose stack or stale deploy is holding the port:

```bash
# Find what's using the port
docker ps --format '{{.Names}} {{.Ports}}' | grep :5000

# Stop it
docker stop container-name
```

If it's a compose-managed container, stop it from compose:
```bash
docker compose stop service-name
```

### Nginx Not Swapping

The `sed` command in `swap_nginx()` matches `proxy_pass http://localhost:PORT;`. If your nginx config uses a different format (upstream blocks, variables, etc.), the sed pattern won't match. Keep `proxy_pass` in the simple `http://localhost:PORT` format.

### MySQL IP Changes After Restart

If you do a full `docker compose down && docker compose up`, MySQL may get a different IP on `skylink-net`. Update the `-e DB_HOST=` value in `extra_flags()` in deploy.sh and restart your app containers.

To make this automatic, use container hostname resolution instead. If hostname resolution works in your setup (run `docker exec your-app node -e "require('dns').lookup('your-mysql', console.log)"` to verify), use `DB_HOST=your-mysql` and skip the IP override.

---

## 13. Troubleshooting

### Health check keeps failing

```bash
# Check container logs immediately after it starts
docker logs app-app1-api-green --tail 30

# Test health endpoint directly
curl -v http://localhost:NEW_PORT/health

# Check if container is even running
docker ps | grep app1
```

Common causes:
- Missing `/health` endpoint in your app
- App failing to start (bad env var, missing file, DB connection error)
- App starts but takes longer than 60s to be ready increase `HEALTH_RETRIES`

### 502 Bad Gateway after deploy

Nginx is pointing to a port with no container listening:

```bash
# Check what port nginx is sending to
grep proxy_pass /etc/nginx/sites-available/your-app.conf

# Check what's running on that port
docker ps --format '{{.Names}} {{.Ports}}' | grep PORT

# Fix nginx manually
sudo sed -i 's/localhost:OLD_PORT/localhost:CORRECT_PORT/' /etc/nginx/sites-available/your-app.conf
sudo nginx -t && sudo systemctl reload nginx

# Fix the slot state file
echo "blue" > /opt/your-infra/deploy/state/app1-api.slot
```

### getaddrinfo ENOTFOUND container-name

Container hostname DNS resolution failing:

```bash
# Verify both containers are on the same network
docker network inspect skylink-net --format '{{range .Containers}}{{.Name}} {{end}}'

# Test DNS from inside the container
docker exec your-app node -e "require('dns').lookup('your-mysql', console.log)"

# If DNS works but app still fails, it's an ES module hoisting issue
# Move setDefaultResultOrder to dbConnection.js line 1
```

### Access denied for user 'name\t'@'host'

Trailing tab in env file:

```bash
cat -A your.env | grep DB_USER
# If you see ^I before $ it's a tab

sed -i 's/\t//g' your.env
```

### Deploy script — unbound variable at line N

Bash is parsing a hyphenated key as arithmetic. Make sure your deploy script uses `case` statements, not `declare -A`.

---

## 14. Quick Reference

### Deploy Commands

```bash
# Deploy a single app
/opt/your-infra/deploy/deploy.sh app1-api

# Deploy all apps
/opt/your-infra/deploy/deploy.sh --all

# Watch deploy logs live
tail -f /opt/your-infra/deploy/logs/deploy.log

# Check current active slot per app
cat /opt/your-infra/deploy/state/*.slot

# Manually fix a slot state
echo "blue" > /opt/your-infra/deploy/state/app1-api.slot
```

### Container Management

```bash
# List all containers with ports
docker ps --format 'table {{.Names}}\t{{.Ports}}\t{{.Status}}'

# View recent logs
docker logs app-app1-api-blue --tail 50

# Force kill a stuck container
docker rm -f container-name

# Connect a container to the shared network
docker network connect skylink-net container-name

# Get a container's IP on a specific network
docker inspect container-name --format '{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}'
```

### Nginx

```bash
# Test config syntax
sudo nginx -t

# Reload (zero downtime)
sudo systemctl reload nginx

# Check what port an app is proxying to
grep proxy_pass /etc/nginx/sites-available/your-app.conf

# Manually swap a port
sudo sed -i 's/localhost:5010/localhost:5000/' /etc/nginx/sites-available/your-app.conf
sudo nginx -t && sudo systemctl reload nginx
```

### MySQL

```bash
# Connect to MySQL inside Docker
docker exec -it your-mysql mysql -u root -p'yourpassword'

# Show all databases
docker exec -it your-mysql mysql -u root -p'yourpassword' -e "SHOW DATABASES;"

# Create a user (MySQL 8.4+ compatible)
docker exec -it your-mysql mysql -u root -p'yourpassword' -e "
CREATE USER 'app_user'@'%' IDENTIFIED BY 'password';
GRANT ALL PRIVILEGES ON your_db.* TO 'app_user'@'%';
FLUSH PRIVILEGES;
"

# Backup all databases
docker exec your-mysql mysqldump -u root -p'yourpassword' \
  --all-databases --single-transaction --routines --triggers \
  > backup-$(date +%Y%m%d-%H%M%S).sql
```

---

*Guide authored from production implementation. Tested on Ubuntu 24.04 LTS, Docker 26, Nginx 1.24, Node.js 22, MySQL 8.4.*
