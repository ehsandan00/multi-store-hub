#!/usr/bin/env bash
set -euo pipefail

APP_DIR=/opt/multi-store-hub
PUBLIC_URL=http://185.164.72.108
REPO_URL=https://github.com/ehsandan00/multi-store-hub.git

export DEBIAN_FRONTEND=noninteractive

echo "==> System packages"
apt-get update -y
apt-get upgrade -y
apt-get install -y curl git nginx ufw ca-certificates gnupg postgresql-client

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install -g pnpm@9 pm2

systemctl enable --now nginx
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "==> Clone / update app"
mkdir -p "$APP_DIR"
if [[ -d "$APP_DIR/.git" ]]; then
  cd "$APP_DIR"
  git fetch origin
  git reset --hard origin/main
else
  git clone "$REPO_URL" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> Database services (native — Docker Hub often blocked in Iran)"
apt-get install -y postgresql redis-server
systemctl enable --now postgresql redis-server

if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='hub'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE USER hub WITH PASSWORD 'hub';"
fi
if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='multi_store_hub'" | grep -q 1; then
  sudo -u postgres psql -c "CREATE DATABASE multi_store_hub OWNER hub;"
fi
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE multi_store_hub TO hub;"
redis-cli ping

echo "==> Environment"
JWT_ACCESS_SECRET=$(openssl rand -hex 48)
JWT_REFRESH_SECRET=$(openssl rand -hex 48)
ENCRYPTION_KEY=$(openssl rand -hex 32)
cat > "$APP_DIR/.env" <<EOF
NODE_ENV=production
PORT=3001
CORS_ORIGIN=${PUBLIC_URL}

DATABASE_URL=postgresql://hub:hub@localhost:5432/multi_store_hub?schema=public

JWT_ACCESS_SECRET=${JWT_ACCESS_SECRET}
JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

ENCRYPTION_KEY=${ENCRYPTION_KEY}

FOREIGN_PROXY_URL=
FOREIGN_PROXY_USERNAME=
FOREIGN_PROXY_PASSWORD=

HTTP_TIMEOUT_DIRECT_MS=15000
HTTP_TIMEOUT_PROXY_MS=30000
HTTP_RETRIES_DIRECT=2
HTTP_RETRIES_PROXY=3

THROTTLE_TTL=60000
THROTTLE_LIMIT=5

REDIS_URL=redis://localhost:6379

ANTHROPIC_API_KEY=
EOF

echo "==> Install + migrate + build"
cd "$APP_DIR"
cp "$APP_DIR/.env" "$APP_DIR/packages/backend/.env"
pnpm install --frozen-lockfile
cd packages/backend
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm prisma:seed
cd "$APP_DIR"
pnpm build
cd packages/admin
VITE_API_URL=/api pnpm build

echo "==> PM2 backend"
cd "$APP_DIR/packages/backend"
pm2 delete msh-api 2>/dev/null || true
pm2 start dist/main.js --name msh-api
pm2 save
pm2 startup systemd -u root --hp /root >/tmp/pm2-startup.txt || true
bash /tmp/pm2-startup.txt 2>/dev/null || true

echo "==> nginx"
cat > /etc/nginx/sites-available/multi-store-hub <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 185.164.72.108 _;

    root /opt/multi-store-hub/packages/admin/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 20m;
    }
}
NGINX

rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/multi-store-hub /etc/nginx/sites-enabled/multi-store-hub
nginx -t
systemctl reload nginx

echo "==> Smoke tests"
curl -sf -o /dev/null -w "admin:%{http_code}\n" http://127.0.0.1/
curl -sf -o /dev/null -w "api:%{http_code}\n" -X POST http://127.0.0.1:3001/auth/login -H 'Content-Type: application/json' -d '{}'

echo "DEPLOY_OK ${PUBLIC_URL}"
