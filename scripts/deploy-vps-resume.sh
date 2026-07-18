#!/usr/bin/env bash
set -euo pipefail
APP_DIR=/opt/multi-store-hub
PUBLIC_URL=http://185.164.72.108
cd "$APP_DIR"
cp "$APP_DIR/.env" "$APP_DIR/packages/backend/.env"
cd packages/backend
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm prisma:seed
cd "$APP_DIR"
pnpm build
cd packages/admin
VITE_API_URL=/api pnpm build
cd "$APP_DIR/packages/backend"
pm2 delete msh-api 2>/dev/null || true
pm2 start dist/main.js --name msh-api
pm2 save
cat > /etc/nginx/sites-available/multi-store-hub <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name 185.164.72.108 _;
    root /opt/multi-store-hub/packages/admin/dist;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
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
nginx -t && systemctl reload nginx
curl -sf -o /dev/null -w "admin:%{http_code}\n" http://127.0.0.1/
echo "DEPLOY_OK ${PUBLIC_URL}"
