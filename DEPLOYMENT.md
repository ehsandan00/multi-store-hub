# Multi-Store Hub — Production / VPS Deployment Guide

Complete reference for running this hub on a Linux server or VPS.

---

## 1. Default login users (after `pnpm db:seed`)

These are created by the seed script. **Change all passwords before going live.**

| Email               | Password        | Role            | Use for                          |
| ------------------- | --------------- | --------------- | -------------------------------- |
| `admin@hub.local`   | `Admin@123`     | ADMIN           | Full access, users, all settings |
| `warehouse@hub.local` | `Warehouse@123` | WAREHOUSE_STAFF | Products, import, sync, matching |
| `viewer@hub.local`  | `Viewer@123`    | VIEWER          | Read-only dashboards & lists     |

Login URL (production example): `https://your-domain.com/login`

---

## 2. What this app is (stack summary)

| Component   | Technology              | Runtime on server        |
| ----------- | ----------------------- | ------------------------ |
| Backend API | NestJS + TypeScript     | **Node.js 20+** process  |
| Admin UI    | React + Vite + Tailwind | **Static files** (nginx) |
| Database    | PostgreSQL 16           | Docker or native service |
| Queue       | BullMQ + Redis 7        | Docker or native service |
| ORM         | Prisma                  | migrations at deploy     |

**Required services on the VPS:** Node.js, PostgreSQL, Redis, reverse proxy (nginx/Caddy), optional Docker.

**Not required on VPS:** pnpm dev servers in production — build once, run compiled backend + static admin.

---

## 3. Recommended VPS specs

### Minimum (testing / 1–2 stores, light traffic)

| Resource | Spec |
| -------- | ---- |
| CPU      | 2 vCPU |
| RAM      | 4 GB |
| Disk     | 40 GB SSD |
| OS       | Ubuntu 22.04 or 24.04 LTS |

### Recommended (8 WooCommerce stores, sync + import jobs)

| Resource | Spec |
| -------- | ---- |
| CPU      | 4 vCPU |
| RAM      | 8 GB |
| Disk     | 80 GB SSD (DB + logs + Excel exports) |
| OS       | Ubuntu 22.04 or 24.04 LTS |

### Why these numbers

- **Node backend:** ~150–400 MB RAM at idle; spikes during Excel import, sync pushes, AI matching.
- **PostgreSQL:** 512 MB–2 GB depending on order/product volume.
- **Redis (BullMQ):** 128–512 MB; required for import commits, WooCommerce sync, order pull, matching jobs.
- **8 stores syncing:** concurrent HTTP to WooCommerce + queue workers benefits from extra CPU.

### Network (critical for this project)

Your stores split into two groups:

1. **Foreign / censored sites** — hub must reach them via `VIA_FOREIGN_PROXY` (non-Iran IP proxy).
2. **Iran-hosted sites** — often require **Iranian server IP**; a pure EU/US VPS may fail test-connection.

**Practical options:**

- Run the hub on an **Iranian VPS** and set `FOREIGN_PROXY_URL` for blocked foreign stores, **or**
- Run on a **foreign VPS** with a reliable proxy to Iran-hosted stores (harder), **or**
- Split: hub in Iran + outbound foreign proxy only for Group A sites.

Test `POST /sites/:id/test-connection` for every store after deploy.

### Provider examples (pick by location & budget)

| Region / need        | Examples (not endorsements)     |
| -------------------- | ------------------------------- |
| Iran domestic WC     | Arvan Cloud, IranServer, ParsVDS |
| EU / global          | Hetzner, DigitalOcean, Linode   |
| Managed easy setup   | DigitalOcean App Platform*, Railway* (*need Postgres + Redis add-ons) |

---

## 4. Server preparation (Ubuntu 24.04)

SSH into the VPS as root or sudo user.

```bash
# System update
sudo apt update && sudo apt upgrade -y

# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# pnpm
sudo npm install -g pnpm@9

# nginx + certbot (HTTPS)
sudo apt install -y nginx certbot python3-certbot-nginx

# Docker (Postgres + Redis)
sudo apt install -y docker.io docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker $USER
# log out and back in after usermod

# PM2 (keep Node backend running)
sudo npm install -g pm2

# Firewall
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

---

## 5. Deploy the application

### 5.1 Clone / upload code

```bash
sudo mkdir -p /opt/multi-store-hub
sudo chown $USER:$USER /opt/multi-store-hub
cd /opt/multi-store-hub

# Option A: git clone your repo
git clone <YOUR_REPO_URL> .

# Option B: upload zip and extract
```

### 5.2 Start PostgreSQL + Redis

```bash
cd /opt/multi-store-hub
docker compose up -d
docker compose ps   # postgres + redis should be healthy
```

Default DB from `docker-compose.yml`:

- Host: `localhost:5432`
- User / password / database: `hub` / `hub` / `multi_store_hub`

**Production:** change Postgres password in `docker-compose.yml` and match `DATABASE_URL`.

### 5.3 Environment file

```bash
cp .env.example .env
nano .env
```

**Production `.env` example** (replace secrets and domain):

```env
NODE_ENV=production
PORT=3001
# Comma-separated list of every URL you open the admin from (exact scheme + host, no trailing slash).
# Example with multiple domains: http://kamandhub.ir,https://kamandhub.ir,http://185.164.72.108
CORS_ORIGIN=https://hub.example.com

DATABASE_URL=postgresql://hub:STRONG_DB_PASSWORD@localhost:5432/multi_store_hub?schema=public

JWT_ACCESS_SECRET=PASTE_64_PLUS_RANDOM_CHARS
JWT_REFRESH_SECRET=PASTE_ANOTHER_64_PLUS_RANDOM_CHARS
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# openssl rand -hex 32
ENCRYPTION_KEY=PASTE_64_HEX_CHARS

FOREIGN_PROXY_URL=http://user:pass@proxy.example.com:8080
FOREIGN_PROXY_USERNAME=
FOREIGN_PROXY_PASSWORD=

HTTP_TIMEOUT_DIRECT_MS=15000
HTTP_TIMEOUT_PROXY_MS=30000
HTTP_RETRIES_DIRECT=2
HTTP_RETRIES_PROXY=3

THROTTLE_TTL=60000
THROTTLE_LIMIT=5

REDIS_URL=redis://localhost:6379

# Optional — AI matching (Phase 5)
ANTHROPIC_API_KEY=
```

Generate secrets:

```bash
openssl rand -hex 48    # JWT secrets
openssl rand -hex 32    # ENCRYPTION_KEY (must be exactly 64 hex chars)
```

### 5.4 Install, migrate, seed, build

```bash
cd /opt/multi-store-hub
pnpm install --frozen-lockfile

# Database schema
pnpm db:migrate
# For production CI/CD use instead:
# cd packages/backend && pnpm prisma:migrate:deploy

# Default users (admin@hub.local / Admin@123, etc.)
pnpm db:seed

# Build backend + admin
pnpm build
```

Build admin with API URL (relative path works with nginx rewrite below):

```bash
cd packages/admin
VITE_API_URL=/api pnpm build
# output: packages/admin/dist/
```

### 5.5 Run backend with PM2

```bash
cd /opt/multi-store-hub/packages/backend
pm2 start dist/main.js --name msh-api
pm2 save
pm2 startup   # follow printed command to enable boot restart
```

Check:

```bash
curl -s http://127.0.0.1:3001/api/docs | head
pm2 logs msh-api
```

---

## 6. nginx (HTTPS + admin + API)

Replace `hub.example.com` with your domain.

```bash
sudo nano /etc/nginx/sites-available/multi-store-hub
```

```nginx
server {
    listen 80;
    server_name hub.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name hub.example.com;

    ssl_certificate     /etc/letsencrypt/live/hub.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/hub.example.com/privkey.pem;

    # Admin panel (React build)
    root /opt/multi-store-hub/packages/admin/dist;
    index index.html;

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API → NestJS (strip /api prefix; backend routes have no /api prefix)
    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;   # Excel uploads
    }

    # Swagger (optional — restrict in production)
    location /api/docs {
        rewrite ^/api/docs(.*) /api/docs$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
    }
}
```

Enable site and TLS:

```bash
sudo ln -sf /etc/nginx/sites-available/multi-store-hub /etc/nginx/sites-enabled/
sudo nginx -t
sudo certbot --nginx -d hub.example.com
sudo systemctl reload nginx
```

Open: `https://hub.example.com` → login with `admin@hub.local` / `Admin@123`.

---

## 7. Post-deploy checklist

- [ ] Change all seeded passwords (Users page or new admin user + disable defaults).
- [ ] Strong `JWT_*` and `ENCRYPTION_KEY`; never commit `.env`.
- [ ] Postgres password not default `hub`.
- [ ] `REDIS_URL` set (imports/sync/order pull/matching queues need Redis).
- [ ] `CORS_ORIGIN` matches your HTTPS admin URL.
- [ ] Add all 8 WooCommerce sites; set `network_route` per site.
- [ ] Run **Test Connection** on each site.
- [ ] Enable sync / order-pull schedules as needed.
- [ ] Restrict or remove public Swagger in production (firewall or nginx auth).
- [ ] Backups: Postgres volume `msh-postgres-data` daily.

---

## 8. Updates / redeploy

```bash
cd /opt/multi-store-hub
git pull
pnpm install --frozen-lockfile
pnpm db:migrate          # or prisma migrate deploy in backend
pnpm build
cd packages/admin && VITE_API_URL=/api pnpm build
pm2 restart msh-api
sudo systemctl reload nginx
```

---

## 9. Useful commands

| Task | Command |
| ---- | ------- |
| Dev (local) | `pnpm dev` from repo root |
| Backend logs | `pm2 logs msh-api` |
| DB shell | `docker exec -it msh-postgres psql -U hub -d multi_store_hub` |
| Redis ping | `docker exec -it msh-redis redis-cli ping` |
| Prisma Studio | `pnpm db:studio` (dev only; do not expose publicly) |
| Run tests | `pnpm test` |

---

## 10. Ports reference

| Service    | Port  | Public? |
| ---------- | ----- | ------- |
| Admin (dev)| 5173  | No      |
| API        | 3001  | No (nginx only) |
| PostgreSQL | 5432  | No      |
| Redis      | 6379  | No      |
| nginx HTTPS| 443   | Yes     |

---

## 11. Troubleshooting

| Problem | Likely fix |
| ------- | ---------- |
| Login 401 / CORS error | Add **every** admin URL to `CORS_ORIGIN` (comma-separated, exact scheme/host, no trailing slash). Missing origin causes login to fail. After editing `.env`, run `cp .env packages/backend/.env && pm2 restart msh-api --update-env`. |
| Import/sync stuck | Check `REDIS_URL`, `docker compose ps`, `pm2 logs` |
| WC test-connection fails | Wrong `network_route` or proxy; site blocks VPS IP |
| Admin loads, API 404 | nginx rewrite `/api/` → backend; rebuild admin with `VITE_API_URL=/api` |
| `ENCRYPTION_KEY` boot error | Must be exactly 64 hex characters |

---

## 12. File layout on server

```
/opt/multi-store-hub/
├── .env                          # secrets (never in git)
├── docker-compose.yml            # postgres + redis
├── packages/
│   ├── backend/
│   │   ├── dist/main.js          # PM2 runs this
│   │   └── prisma/migrations/
│   └── admin/
│       └── dist/                 # nginx root
└── DEPLOYMENT.md                 # this file
```

---

*Multi-Store Hub — Phases 1–6 complete. For local development see README.md.*
