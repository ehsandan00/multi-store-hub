# Update hub on ParsPack server

After you change code on your PC, push to GitHub then update the server.

## 1. On your PC (push changes)

```powershell
cd C:\Users\User\Projects\multi-store-hub
git add -A
git commit -m "Describe your change"
git push origin main
```

## 2. On the server (SSH as root)

```bash
ssh root@185.164.72.108
cd /opt/multi-store-hub
git pull origin main
pnpm install --frozen-lockfile
cp .env packages/backend/.env
cd packages/backend && pnpm prisma:migrate:deploy && cd ../..
pnpm build
cd packages/admin && VITE_API_URL=/api pnpm build && cd ../..
pm2 restart msh-api
sudo systemctl reload nginx
```

## 3. Verify

Open http://185.164.72.108 (or your HTTPS domain) and test the changed feature.

## One-line update (after SSH login)

```bash
cd /opt/multi-store-hub && git pull && pnpm install --frozen-lockfile && cp .env packages/backend/.env && cd packages/backend && pnpm prisma:migrate:deploy && cd ../.. && pnpm build && cd packages/admin && VITE_API_URL=/api pnpm build && cd ../.. && pm2 restart msh-api && sudo systemctl reload nginx
```

## Notes

- **Database migrations** run automatically with `prisma migrate deploy`.
- **`.env`** is never in git — edit it on the server only: `nano /opt/multi-store-hub/.env` then `pm2 restart msh-api`.
- **Backend logs:** `pm2 logs msh-api`

---

# HTTPS on ParsPack (for phone camera)

Browsers require **HTTPS** for live camera. HTTP only supports photo scan.

## Requirements

1. A **domain name** (e.g. `hub.yourshop.ir`)
2. DNS **A record** pointing to `185.164.72.108`

## Steps (on server)

### 1. Update nginx to use your domain

```bash
nano /etc/nginx/sites-available/multi-store-hub
```

Change `server_name` to your domain:

```nginx
server_name hub.yourshop.ir;
```

Test and reload:

```bash
nginx -t && systemctl reload nginx
```

### 2. Get free SSL certificate (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d hub.yourshop.ir
```

Follow prompts (email, agree to terms). Certbot updates nginx for HTTPS automatically.

### 3. Update hub CORS

```bash
nano /opt/multi-store-hub/.env
```

Set:

```env
CORS_ORIGIN=https://hub.yourshop.ir
```

Then:

```bash
cp /opt/multi-store-hub/.env /opt/multi-store-hub/packages/backend/.env
pm2 restart msh-api
```

### 4. Open in browser

```
https://hub.yourshop.ir
```

Live barcode camera should work on your phone.

## Renew certificate

Certbot auto-renews. Test with:

```bash
certbot renew --dry-run
```

## If Let's Encrypt fails in Iran

Some networks block Let's Encrypt validation. Options:

- Use ParsPack panel SSL if they offer it
- Use **Cloudflare** DNS proxy (orange cloud) + SSL
- Temporarily use HTTP + **photo scan** only
