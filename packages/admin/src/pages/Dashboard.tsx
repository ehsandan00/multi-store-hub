import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { dashboardApi, toApiError } from '../lib/api';
import { useAuthStore } from '../lib/auth-store';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { formatDate, daysUntil } from '../lib/utils';
import type { Role, RevenueSeriesPoint } from '../lib/types';
import { productsApi } from '../lib/api';

const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  WAREHOUSE_STAFF: 'Warehouse staff',
  VIEWER: 'Viewer',
};

const STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber' | 'blue'> = {
  completed: 'green',
  processing: 'blue',
  on_hold: 'amber',
  pending: 'amber',
  cancelled: 'red',
  refunded: 'red',
  failed: 'red',
};

export function Dashboard() {
  const { user } = useAuthStore();

  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => dashboardApi.summary(),
    staleTime: 30_000,
  });

  const k = summaryQ.data?.kpis;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          Welcome back, {user?.email}. You are signed in as{' '}
          <Badge tone="blue">{user && ROLE_LABEL[user.role]}</Badge>
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <KpiCard
          label="Total products"
          value={summaryQ.isLoading ? null : String(k?.totalProducts ?? 0)}
        />
        <KpiCard
          label="Low-stock alerts"
          value={summaryQ.isLoading ? null : String(k?.lowStockCount ?? 0)}
          tone={(k?.lowStockCount ?? 0) > 0 ? 'amber' : 'gray'}
        />
        <KpiCard
          label="Active sites"
          value={summaryQ.isLoading ? null : `${k?.activeSites ?? 0} / ${k?.totalSites ?? 0}`}
        />
        <KpiCard
          label="Orders (last 30d)"
          value={summaryQ.isLoading ? null : String(k?.ordersLast30d ?? 0)}
          hint={`${k?.totalOrders ?? 0} all-time`}
        />
      </div>

      {summaryQ.isError && (
        <Card className="p-4 text-sm text-rose-600">
          Failed to load dashboard summary: {toApiError(summaryQ.error).message}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Revenue sparkline (last 30d) */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Revenue (last 30 days)</h2>
            <span className="text-xs text-slate-500">{summaryQ.data ? `since ${formatDate(summaryQ.data.since)}` : ''}</span>
          </div>
          <RevenueSparkline points={summaryQ.data?.revenueSeries ?? []} loading={summaryQ.isLoading} />
        </Card>

        {/* Order status breakdown */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Order status (last 30d)</h2>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.statusBreakdown.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No orders in the last 30 days.</p>
          ) : (
            <ul className="space-y-2">
              {(summaryQ.data?.statusBreakdown ?? []).map((s) => (
                <li key={s.status} className="flex items-center justify-between text-sm">
                  <Badge tone={STATUS_TONE[s.status] ?? 'gray'}>{s.status}</Badge>
                  <span className="font-medium text-slate-800">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Top products by qty */}
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Top products (by qty, last 30d)</h2>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.topProducts.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No sales recorded in the last 30 days.</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {(summaryQ.data?.topProducts ?? []).map((p, i) => (
                <li key={p.productId ?? i} className="flex items-center justify-between">
                  <span className="truncate text-slate-700">
                    <span className="mr-2 text-slate-400">{i + 1}.</span>
                    {p.name ?? p.skuMaster ?? 'Unknown'}
                  </span>
                  <span className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-slate-500">{p.quantity} sold</span>
                    <Badge tone="green">{formatMoneyShort(p.revenue)}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        {/* Recent orders */}
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Recent orders</h2>
            <Link to="/orders" className="text-xs font-medium text-brand-600 hover:underline">
              View all →
            </Link>
          </div>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.recentOrders.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No orders yet. Pull orders from a site on the Sync page.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(summaryQ.data?.recentOrders ?? []).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to="/orders" className="truncate text-slate-700 hover:text-brand-700">
                    <span className="font-mono text-xs">#{o.orderNumber}</span>
                    <span className="ml-2 text-slate-500">{o.siteName}</span>
                  </Link>
                  <span className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{formatDate(o.dateCreated)}</span>
                    <Badge tone={STATUS_TONE[o.status] ?? 'gray'}>{o.status}</Badge>
                    <span className="font-medium text-slate-800">{formatMoneyShort(o.totalAmount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* Low-stock products + upcoming expiries */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Low-stock products</h2>
            <Link to="/products?lowStock=1" className="text-xs font-medium text-brand-600 hover:underline">
              Manage →
            </Link>
          </div>
          {(summaryQ.data?.lowStockProducts.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">All products are above their low-stock threshold.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(summaryQ.data?.lowStockProducts ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to={`/products/${p.id}`} className="truncate text-slate-700 hover:text-brand-700">
                    {p.name} <span className="text-slate-400">· {p.skuMaster}</span>
                  </Link>
                  <span className="ml-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{p.totalStock} / {p.lowStockThreshold}</span>
                    <Badge tone="red">low</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Upcoming expiries (next 30 days)</h2>
          <UpcomingExpiries />
        </Card>
      </div>
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

function RevenueSparkline({ points, loading }: { points: RevenueSeriesPoint[]; loading: boolean }) {
  if (loading) return <Spinner className="h-5 w-5" />;
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">No revenue recorded in the last 30 days.</p>;
  }
  const revenues = points.map((p) => Number(p.revenue));
  const max = Math.max(...revenues, 0);
  const min = Math.min(...revenues, 0);
  const range = max - min || 1;
  const width = 100;
  const height = 32;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const coords = points.map((p, i) => {
    const x = i * step;
    const v = Number(p.revenue);
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const total = revenues.reduce((a, b) => a + b, 0);
  return (
    <div>
      <p className="mb-2 text-2xl font-semibold text-slate-900">{formatMoneyShort(String(total.toFixed(2)))}</p>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-16 w-full" preserveAspectRatio="none">
        <polyline
          fill="none"
          stroke="rgb(37 99 235)"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          points={coords.join(' ')}
        />
      </svg>
      <p className="mt-1 text-[11px] text-slate-400">{points.length} day(s) with sales</p>
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

function formatMoneyShort(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}
