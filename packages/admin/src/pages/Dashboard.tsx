import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { productsApi, sitesApi } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { formatDate, daysUntil } from '../lib/utils';
import type { Role } from '../lib/types';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  WAREHOUSE_STAFF: 'Warehouse staff',
  VIEWER: 'Viewer',
};

export function Dashboard() {
  const { user } = useAuthStore();

  const productsQ = useQuery({
    queryKey: ['products', { page: 1, pageSize: 1 }],
    queryFn: () => productsApi.list({ page: 1, pageSize: 1 }),
  });
  const lowStockQ = useQuery({
    queryKey: ['products', 'low-stock-count'],
    queryFn: () => productsApi.list({ lowStock: true, pageSize: 200 }),
  });
  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
  });

  const totalProducts = productsQ.data?.total ?? 0;
  const lowStockCount = lowStockQ.data?.data.length ?? 0;
  const activeSites = sitesQ.data?.data.filter((s) => s.isActive).length ?? 0;
  const totalSites = sitesQ.data?.data.length ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Welcome back, {user?.email}. You are signed in as{' '}
          <Badge tone="blue">{user && ROLE_LABEL[user.role]}</Badge>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total products"
          value={productsQ.isLoading ? null : String(totalProducts)}
        />
        <KpiCard
          label="Low-stock alerts"
          value={lowStockQ.isLoading ? null : String(lowStockCount)}
          tone={lowStockCount > 0 ? 'amber' : 'gray'}
        />
        <KpiCard
          label="Active sites"
          value={sitesQ.isLoading ? null : `${activeSites} / ${totalSites}`}
        />
        <KpiCard
          label="Latest sync"
          value="—"
          hint="Wired in Phase 6 (Reporting)"
        />
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Phase 1 status</h2>
          <Link to="/products" className="text-xs font-medium text-brand-600 hover:underline">
            Go to products →
          </Link>
        </div>
        <ul className="space-y-2 text-sm text-slate-600">
          <li>✅ Auth + RBAC (3 roles), JWT access &amp; refresh tokens</li>
          <li>✅ Product CRUD with expiry date, low-stock filter, inventory history</li>
          <li>✅ Site CRUD with network_route, encrypted credentials, Test Connection</li>
          <li>✅ Audit log on site/product/user mutations</li>
          <li className="text-slate-400">⏳ Excel import/export — Phase 2</li>
          <li className="text-slate-400">⏳ WooCommerce sync — Phase 3</li>
          <li className="text-slate-400">⏳ AI matching — Phase 4</li>
          <li className="text-slate-400">⏳ Orders &amp; customers — Phase 5</li>
          <li className="text-slate-400">⏳ Reporting &amp; full dashboard — Phase 6</li>
        </ul>
      </Card>

      {/* Upcoming expiry preview — small useful widget driven by current product list */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Upcoming expiries (next 30 days)</h2>
        <UpcomingExpiries />
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'gray',
}: {
  label: string;
  value: string | null;
  hint?: string;
  tone?: 'gray' | 'amber';
}) {
  return (
    <div
      className={
        'card p-4 ' +
        (tone === 'amber' ? 'border-amber-200 bg-amber-50' : '')
      }
    >
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        {value === null ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

function UpcomingExpiries() {
  const { data, isLoading } = useQuery({
    queryKey: ['products', 'upcoming-expiry'],
    queryFn: () => productsApi.list({ pageSize: 200 }),
  });
  if (isLoading) return <Spinner className="h-5 w-5" />;
  const upcoming = (data?.data ?? [])
    .filter((p) => {
      const d = daysUntil(p.expiryDate);
      return d !== null && d >= 0 && d <= 30;
    })
    .sort((a, b) => (daysUntil(a.expiryDate)! - daysUntil(b.expiryDate)!));

  if (upcoming.length === 0) {
    return <p className="text-sm text-slate-500">No products expiring in the next 30 days.</p>;
  }
  return (
    <ul className="divide-y divide-slate-100">
      {upcoming.slice(0, 6).map((p) => {
        const d = daysUntil(p.expiryDate)!;
        return (
          <li key={p.id} className="flex items-center justify-between py-2 text-sm">
            <Link to={`/products/${p.id}`} className="truncate text-slate-700 hover:text-brand-700">
              {p.name} <span className="text-slate-400">· {p.skuMaster}</span>
            </Link>
            <span className="ml-3 flex shrink-0 items-center gap-2">
              <span className="text-xs text-slate-500">{formatDate(p.expiryDate)}</span>
              <Badge tone={d <= 7 ? 'red' : 'amber'}>{d}d</Badge>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
