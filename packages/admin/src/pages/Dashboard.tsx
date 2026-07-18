import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { dashboardApi, toApiError } from '../lib/api';
import { isoDateDaysAgo, isoDateLocal } from '../lib/barcode';
import { getAlertBreakdown } from '../lib/alert-breakdown';
import { useAuthStore } from '../lib/auth-store';
import { Card } from '../components/ui/Card';
import { Spinner } from '../components/ui/Spinner';
import { Badge } from '../components/ui/Badge';
import { formatDate, daysUntil } from '../lib/utils';
import type { RevenueSeriesPoint } from '../lib/types';

const SYNC_STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber'> = {
  success: 'green',
  failed: 'red',
  partial: 'amber',
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
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const today = isoDateLocal();
  const since30d = isoDateDaysAgo(30);

  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: () => dashboardApi.summary(),
    staleTime: 30_000,
  });

  const k = summaryQ.data?.kpis;
  const alerts = getAlertBreakdown(summaryQ.data);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {t('dashboard.welcome', { email: user?.email })}{' '}
          <Badge tone="blue">{user && t(`roles.${user.role}`)}</Badge>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-4">
        <KpiCard
          label={t('dashboard.totalProducts')}
          value={summaryQ.isLoading ? null : String(k?.totalProducts ?? 0)}
          hint={
            summaryQ.isLoading
              ? undefined
              : t('dashboard.unitsInStock', { count: k?.inventoryUnits ?? 0 })
          }
          to="/products"
        />
        <KpiCard
          label={t('dashboard.inventoryValue')}
          value={summaryQ.isLoading ? null : formatMoneyShort(k?.inventoryValue ?? '0')}
          to="/products"
        />
        <KpiCard
          label={t('dashboard.ordersToday')}
          value={summaryQ.isLoading ? null : String(k?.ordersToday ?? 0)}
          hint={summaryQ.isLoading ? undefined : formatMoneyShort(k?.revenueToday ?? '0')}
          to={`/orders?dateFrom=${today}&dateTo=${today}`}
        />
        <KpiCard
          label={t('dashboard.ordersLast30d')}
          value={summaryQ.isLoading ? null : String(k?.ordersLast30d ?? 0)}
          hint={t('dashboard.allTimeOrders', { count: k?.totalOrders ?? 0 })}
          to={`/orders?dateFrom=${since30d}&dateTo=${today}`}
        />
        <KpiCard
          label={t('dashboard.logisticsSent')}
          value={
            summaryQ.isLoading
              ? null
              : String(summaryQ.data?.logisticsStatusCounts.SENT ?? 0)
          }
          tone="green"
          to="/logistics"
        />
        <KpiCard
          label={t('dashboard.logisticsNeedProduct')}
          value={
            summaryQ.isLoading
              ? null
              : String(summaryQ.data?.logisticsStatusCounts.NEED_PRODUCT ?? 0)
          }
          tone={
            (summaryQ.data?.logisticsStatusCounts.NEED_PRODUCT ?? 0) > 0 ? 'amber' : 'gray'
          }
          to="/logistics"
        />
        <KpiCard
          label={t('dashboard.logisticsCanceled')}
          value={
            summaryQ.isLoading
              ? null
              : String(summaryQ.data?.logisticsStatusCounts.CANCELED ?? 0)
          }
          tone={(summaryQ.data?.logisticsStatusCounts.CANCELED ?? 0) > 0 ? 'red' : 'gray'}
          to="/logistics"
        />
        <KpiCard
          label={t('dashboard.lowStockAlerts')}
          value={summaryQ.isLoading ? null : String(k?.lowStockCount ?? 0)}
          tone={(k?.lowStockCount ?? 0) > 0 ? 'amber' : 'gray'}
          to="/products?lowStock=1"
        />
        <KpiCard
          label={t('dashboard.expiringSoon')}
          value={summaryQ.isLoading ? null : String(k?.expiringSoonCount ?? 0)}
          tone={(k?.expiringSoonCount ?? 0) > 0 ? 'amber' : 'gray'}
          hint={t('dashboard.next30Days')}
          to="/reports?tab=expiry"
        />
        <KpiCard
          label={t('dashboard.activeSites')}
          value={
            summaryQ.isLoading
              ? null
              : t('dashboard.activeSitesValue', {
                  active: k?.activeSites ?? 0,
                  total: k?.totalSites ?? 0,
                })
          }
          to="/sites"
        />
        <KpiCard
          label={t('dashboard.activeAlerts')}
          value={summaryQ.isLoading ? null : String(k?.activeAlerts ?? 0)}
          tone={(k?.activeAlerts ?? 0) > 0 ? 'amber' : 'gray'}
          hint={
            summaryQ.isLoading
              ? undefined
              : t('dashboard.alertsBreakdown', {
                  low: alerts.lowStock,
                  expiring: alerts.expiringSoon,
                  sync: alerts.failedSyncs,
                  mapping: alerts.pendingMappingReviews,
                  dupes: alerts.duplicateOnSite,
                })
          }
          to="/alerts"
        />
      </div>

      {summaryQ.isError && (
        <Card className="p-4 text-sm text-rose-600">
          {t('dashboard.loadFailed', { message: toApiError(summaryQ.error).message })}
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('dashboard.revenueTitle')}</h2>
            <span className="text-xs text-slate-500">
              {summaryQ.data ? t('dashboard.since', { date: formatDate(summaryQ.data.since) }) : ''}
            </span>
          </div>
          <RevenueSparkline points={summaryQ.data?.revenueSeries ?? []} loading={summaryQ.isLoading} />
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('dashboard.orderStatusTitle')}</h2>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.statusBreakdown.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noOrders30d')}</p>
          ) : (
            <ul className="space-y-2">
              {(summaryQ.data?.statusBreakdown ?? []).map((s) => (
                <li key={s.status} className="flex items-center justify-between text-sm">
                  <Badge tone={STATUS_TONE[s.status] ?? 'gray'}>
                    {t(`orderStatus.${s.status}`, s.status)}
                  </Badge>
                  <span className="font-medium text-slate-800">{s.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('dashboard.topProductsTitle')}</h2>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.topProducts.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noSales30d')}</p>
          ) : (
            <ol className="space-y-2 text-sm">
              {(summaryQ.data?.topProducts ?? []).map((p, i) => (
                <li key={p.productId ?? i} className="flex items-center justify-between">
                  <span className="truncate text-slate-700">
                    <span className="me-2 text-slate-400">{i + 1}.</span>
                    {p.name ?? p.skuMaster ?? t('common.unknown')}
                  </span>
                  <span className="ms-3 flex shrink-0 items-center gap-2">
                    <span className="text-slate-500">{t('dashboard.sold', { quantity: p.quantity })}</span>
                    <Badge tone="green">{formatMoneyShort(p.revenue)}</Badge>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('dashboard.recentOrders')}</h2>
            <Link to="/orders" className="text-xs font-medium text-brand-600 hover:underline">
              {t('dashboard.viewAll')}
            </Link>
          </div>
          {summaryQ.isLoading ? (
            <Spinner className="h-5 w-5" />
          ) : (summaryQ.data?.recentOrders.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noOrdersYet')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(summaryQ.data?.recentOrders ?? []).map((o) => (
                <li key={o.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to="/orders" className="truncate text-slate-700 hover:text-brand-700">
                    <span className="font-mono text-xs">#{o.orderNumber}</span>
                    <span className="ms-2 text-slate-500">{o.siteName}</span>
                  </Link>
                  <span className="ms-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{formatDate(o.dateCreated)}</span>
                    <Badge tone={STATUS_TONE[o.status] ?? 'gray'}>
                      {t(`orderStatus.${o.status}`, o.status)}
                    </Badge>
                    <span className="font-medium text-slate-800">{formatMoneyShort(o.totalAmount)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5" id="dashboard-low-stock">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('dashboard.lowStockTitle')}</h2>
            <Link to="/products?lowStock=1" className="text-xs font-medium text-brand-600 hover:underline">
              {t('dashboard.manage')}
            </Link>
          </div>
          {(summaryQ.data?.lowStockProducts.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.allStockOk')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(summaryQ.data?.lowStockProducts ?? []).map((p) => (
                <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                  <Link to={`/products/${p.id}`} className="truncate text-slate-700 hover:text-brand-700">
                    {p.name} <span className="text-slate-400">· {p.skuMaster}</span>
                  </Link>
                  <span className="ms-3 flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">
                      {t('dashboard.stockRatio', {
                        current: p.totalStock,
                        threshold: p.lowStockThreshold,
                      })}
                    </span>
                    <Badge tone="red">{t('common.low')}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5" id="dashboard-expiry">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('dashboard.expiryTitle')}</h2>
            <Link to="/reports?tab=expiry" className="text-xs font-medium text-brand-600 hover:underline">
              {t('dashboard.fullReport')}
            </Link>
          </div>
          {(summaryQ.data?.expiringSoonProducts.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">{t('dashboard.noExpiry')}</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {(summaryQ.data?.expiringSoonProducts ?? []).map((p) => {
                const d = daysUntil(p.expiryDate);
                return (
                  <li key={p.id} className="flex items-center justify-between py-2 text-sm">
                    <Link to={`/products/${p.id}`} className="truncate text-slate-700 hover:text-brand-700">
                      {p.name} <span className="text-slate-400">· {p.skuMaster}</span>
                    </Link>
                    <span className="ms-3 flex shrink-0 items-center gap-2">
                      <span className="text-xs text-slate-500">{formatDate(p.expiryDate)}</span>
                      {d !== null && (
                        <Badge tone={d <= 7 ? 'red' : 'amber'}>{t('dashboard.daysLeft', { days: d })}</Badge>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">{t('dashboard.latestSyncTitle')}</h2>
          <Link to="/reports" className="text-xs font-medium text-brand-600 hover:underline">
            {t('dashboard.syncReport')}
          </Link>
        </div>
        {summaryQ.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : (summaryQ.data?.latestSyncs.length ?? 0) === 0 ? (
          <p className="text-sm text-slate-500">{t('dashboard.noSyncYet')}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {(summaryQ.data?.latestSyncs ?? []).map((s) => (
              <li key={s.siteId} className="flex items-center justify-between py-2 text-sm">
                <span className="text-slate-700">{s.siteName}</span>
                <span className="ms-3 flex shrink-0 items-center gap-2">
                  <span className="text-xs text-slate-500">{s.syncType}</span>
                  <span className="text-xs text-slate-400">{formatDate(s.createdAt)}</span>
                  <Badge tone={SYNC_STATUS_TONE[s.status] ?? 'gray'}>
                    {t(`syncStatus.${s.status}`, s.status)}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'gray',
  to,
}: {
  label: string;
  value: string | null;
  hint?: string;
  tone?: 'gray' | 'amber' | 'green' | 'red';
  to?: string;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        {value === null ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <p className="text-2xl font-semibold text-slate-900">{value}</p>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] text-slate-400">{hint}</p>}
    </>
  );

  const className =
    'card block p-4 transition hover:ring-2 hover:ring-brand-200 ' +
    (tone === 'amber'
      ? 'border-amber-200 bg-amber-50'
      : tone === 'green'
        ? 'border-emerald-200 bg-emerald-50'
        : tone === 'red'
          ? 'border-rose-200 bg-rose-50'
          : '');

  if (to) {
    return (
      <Link to={to} className={className}>
        {inner}
      </Link>
    );
  }

  return <div className={className}>{inner}</div>;
}

function RevenueSparkline({ points, loading }: { points: RevenueSeriesPoint[]; loading: boolean }) {
  const { t } = useTranslation();

  if (loading) return <Spinner className="h-5 w-5" />;
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">{t('dashboard.noRevenue')}</p>;
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
      <p className="mt-1 text-[11px] text-slate-400">
        {t('dashboard.daysWithSales', { count: points.length })}
      </p>
    </div>
  );
}

function formatMoneyShort(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toFixed(2);
}
