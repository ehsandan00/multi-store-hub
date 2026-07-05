# Multi-Store Hub

A centralized hub for managing products, warehouse inventory, and orders across 8 independent WooCommerce stores, with a future-proof path to a full CRM.

> **Status: Phase 2 (Excel import/export) implemented.** Phases 3–6 are scaffolded in the data model but not yet wired.

## Tech Stack

| Layer        | Choice                                                            |
| ------------ | ----------------------------------------------------------------- |
| Backend      | NestJS + TypeScript                                               |
| ORM          | Prisma + PostgreSQL                                               |
| Auth         | JWT (access + refresh), bcrypt, role-based access control (RBAC)  |
| HTTP / proxy | `undici` with per-route proxy, timeout & retry                    |
| API docs     | Swagger / OpenAPI auto-generated via `@nestjs/swagger`            |
| Queue        | BullMQ on Redis (wired in Phase 2 for import commits)             |
| Frontend     | React 18 + TypeScript + Vite + Tailwind CSS + TanStack Query      |
| Pkg manager  | pnpm workspaces                                                   |

## Monorepo Layout

```
multi-store-hub/
├── packages/
│   ├── backend/   # NestJS API
│   └── admin/     # React admin panel
├── docker-compose.yml
└── pnpm-workspace.yaml
```

## Quick Start

### Prerequisites

- Node.js ≥ 20.10
- pnpm ≥ 9 (`npm i -g pnpm`)
- Docker (for local Postgres + Redis) — or run your own

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start Postgres + Redis (Docker)

```bash
docker compose up -d
```

### 3. Configure environment

```bash
cp .env.example .env
# edit .env: set DATABASE_URL, JWT secrets, and ENCRYPTION_KEY (openssl rand -hex 32)
```

### 4. Run Prisma migrations + seed

```bash
pnpm db:migrate
pnpm db:seed
```

### 5. Run the dev servers (backend + admin in parallel)

```bash
pnpm dev
```

- Backend API:        http://localhost:3001
- Swagger UI:         http://localhost:3001/api/docs
- Admin panel:        http://localhost:5173

## Seeded Default Users

| Email                  | Password     | Role            |
| ---------------------- | ------------ | --------------- |
| admin@hub.local        | `Admin@123`  | ADMIN           |
| warehouse@hub.local    | `Warehouse@123` | WAREHOUSE_STAFF |
| viewer@hub.local       | `Viewer@123` | VIEWER          |

> Change these immediately in any non-local environment.

## Phase 1 Acceptance

- JWT login works for all 3 roles; backend & frontend enforce role restrictions.
- Products CRUD with `expiryDate`, low-stock filter, paginated list.
- Sites CRUD with `network_route`, AES-256-GCM encrypted WooCommerce credentials, masked on read.
- `POST /sites/:id/test-connection` returns `{ ok, latencyMs, routeUsed, error? }` and writes a `SyncLog` row.
- Audit log captures site-settings changes, product deletion, and user role changes.
- Unit tests pass (`pnpm test`); typecheck clean (`pnpm typecheck`).

## Phase 2 Acceptance

- `GET /import-export/products.xlsx` — full hub export (Products + SiteMapping sheets), filterable by category / site / stock range.
- `GET /import-export/woo-commerce.csv?wooCommerceForSiteId=…` — WooCommerce-import-ready CSV per site (SKU uses the site mapping when present, else hub `sku_master`).
- `POST /import-export/import/preview` (multipart `file`) — parses + validates an xlsx **without writing**, returns a preview keyed by `sku_master` (new/update/error counts + per-row errors).
- `POST /import-export/import/:jobId/commit` — enqueues a BullMQ job that applies the validated rows; per-row failures don't abort the whole import. Inventory logs are written for stock changes (`IMPORT` reason).
- `POST /import-export/import/:jobId/cancel` — dismiss a preview without applying.
- `GET /import-export/import/:jobId` and `GET /import-export/import` — status + history (paginated).
- Admin panel: Import / Export page with export filters, WooCommerce CSV download, upload → preview → confirm → live progress → final report, plus a recent-jobs table. Role-gated (import = admin + warehouse; full export = all roles).
- Matching is by `sku_master`, not row position — reordering rows is safe. Round-trip (export → re-import) is lossless: the parser recognizes the exact underscore headers the export emits.
- Unit tests pass (`pnpm test`); typecheck clean (`pnpm typecheck`).

## Phase Roadmap

| Phase | Scope                                                           | Status        |
| ----- | --------------------------------------------------------------- | ------------- |
| 1     | Core data model, auth + RBAC, products, sites, test-connection  | ✅ Done       |
| 2     | Excel import/export with preview (BullMQ)                       | ✅ Done       |
| 3     | WooCommerce sync (hub → site), polling, idempotent              | ⏳ Planned    |
| 4     | AI matching (fuzzball + Anthropic Claude)                       | ⏳ Planned    |
| 5     | Order & customer pull from sites                                | ⏳ Planned    |
| 6     | Reporting module + full dashboard KPIs                          | ⏳ Planned    |

## Security Notes

- `.env` is gitignored. Only `.env.example` is committed.
- WooCommerce consumer key/secret are encrypted at rest with AES-256-GCM; the key (`ENCRYPTION_KEY`) lives only in the environment.
- Credentials are never returned in full by the API — only masked (e.g. `••••1234`).
- Login is rate-limited via `@nestjs/throttler` (default 5 attempts / 60s / IP).
- All endpoints validate input with `class-validator`; mutating admin actions are audited.
