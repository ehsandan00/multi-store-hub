#!/usr/bin/env bash
set -euo pipefail
DOMAIN=kamandhub.work.gd
EXTRA_DOMAINS="${EXTRA_DOMAINS:-kamandhub.ir www.kamandhub.ir}"
APP_DIR=/opt/multi-store-hub

cat > /etc/nginx/sites-available/multi-store-hub <<NGINX
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN} ${EXTRA_DOMAINS} 185.164.72.108 _;

    root ${APP_DIR}/packages/admin/dist;
    index index.html;

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location /api/ {
        rewrite ^/api/(.*) /\$1 break;
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        client_max_body_size 20m;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/multi-store-hub /etc/nginx/sites-enabled/multi-store-hub
nginx -t
systemctl reload nginx

# Update CORS — every browser origin must be listed (exact scheme/host, no trailing slash).
CORS_LIST="http://${DOMAIN},https://${DOMAIN},http://185.164.72.108"
for d in ${EXTRA_DOMAINS}; do
  CORS_LIST="${CORS_LIST},http://${d},https://${d}"
done
if grep -q '^CORS_ORIGIN=' "$APP_DIR/.env"; then
  sed -i "s|^CORS_ORIGIN=.*|CORS_ORIGIN=${CORS_LIST}|" "$APP_DIR/.env"
else
  echo "CORS_ORIGIN=${CORS_LIST}" >> "$APP_DIR/.env"
fi
cp "$APP_DIR/.env" "$APP_DIR/packages/backend/.env"
pm2 restart msh-api

echo "DNS check from server:"
dig +short ${DOMAIN} A @8.8.8.8 || true

echo "NGINX_OK"
