import { useMemo, useState, useEffect, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { reportsApi, sitesApi, toApiError } from '../lib/api';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { Input } from '../components/ui/Field';
import { formatDateTime, formatDate } from '../lib/utils';
import type {
  CustomersReportQuery,
  ExpiryReportQuery,
  InventoryReportQuery,
  SalesGroupBy,
  SalesReportQuery,
  SyncReportQuery,
} from '../lib/types';

type Tab = 'inventory' | 'expiry' | 'sales' | 'sync' | 'customers';

const TAB_IDS: Tab[] = ['inventory', 'expiry', 'sales', 'sync', 'customers'];

const SYNC_STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber'> = {
  success: 'green',
  failed: 'red',
  partial: 'amber',
};

export function ReportsPage() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get('tab');
  const [tab, setTab] = useState<Tab>(
    initialTab && TAB_IDS.includes(initialTab as Tab) ? (initialTab as Tab) : 'inventory',
  );
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [inventoryQ, setInventoryQ] = useState<InventoryReportQuery>({});
  const [expiryQ, setExpiryQ] = useState<ExpiryReportQuery>({ days: 30 });
  const [salesQ, setSalesQ] = useState<SalesReportQuery>({ groupBy: 'site' });
  const [syncQ, setSyncQ] = useState<SyncReportQuery>({});
  const [customersQ, setCustomersQ] = useState<CustomersReportQuery>({
    sortBy: 'totalSpent',
    sortDir: 'desc',
  });

  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const qTab = searchParams.get('tab');
    if (qTab && TAB_IDS.includes(qTab as Tab)) {
      setTab(qTab as Tab);
    }
  }, [searchParams]);

  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
    staleTime: 60_000,
  });
  const sites = sitesQ.data?.data ?? [];

  const inventoryListQ = useQuery({
    queryKey: ['reports', 'inventory', inventoryQ, page],
    queryFn: () => reportsApi.inventory({ ...inventoryQ, page, pageSize }),
    enabled: tab === 'inventory',
  });
  const expiryListQ = useQuery({
    queryKey: ['reports', 'expiry', expiryQ, page],
    queryFn: () => reportsApi.expiry({ ...expiryQ, page, pageSize }),
    enabled: tab === 'expiry',
  });
  const salesListQ = useQuery({
    queryKey: ['reports', 'sales', salesQ, page],
    queryFn: () => reportsApi.sales({ ...salesQ, page, pageSize }),
    enabled: tab === 'sales',
  });
  const syncListQ = useQuery({
    queryKey: ['reports', 'sync', syncQ, page],
    queryFn: () => reportsApi.sync({ ...syncQ, page, pageSize }),
    enabled: tab === 'sync',
  });
  const customersListQ = useQuery({
    queryKey: ['reports', 'customers', customersQ, page],
    queryFn: () => reportsApi.customers({ ...customersQ, page, pageSize }),
    enabled: tab === 'customers',
  });

  const activeQ = useMemo(() => {
    switch (tab) {
      case 'inventory':
        return inventoryListQ;
      case 'expiry':
        return expiryListQ;
      case 'sales':
        return salesListQ;
      case 'sync':
        return syncListQ;
      case 'customers':
        return customersListQ;
    }
  }, [tab, inventoryListQ, expiryListQ, salesListQ, syncListQ, customersListQ]);

  const totalPages = activeQ.data && 'totalPages' in activeQ.data ? activeQ.data.totalPages : 1;

  function switchTab(next: Tab) {
    setTab(next);
    setPage(1);
  }

  async function handleExport() {
    setExporting(true);
    try {
      switch (tab) {
        case 'inventory':
          await reportsApi.exportInventory(inventoryQ);
          break;
        case 'expiry':
          await reportsApi.exportExpiry(expiryQ);
          break;
        case 'sales':
          await reportsApi.exportSales(salesQ);
          break;
        case 'sync':
          await reportsApi.exportSync(syncQ);
          break;
        case 'customers':
          await reportsApi.exportCustomers(customersQ);
          break;
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('reports.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">{t('reports.subtitle')}</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void handleExport()} disabled={exporting}>
          {exporting ? t('reports.exporting') : t('reports.exportExcel')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {TAB_IDS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => switchTab(id)}
            className={
              'rounded-md px-3 py-2 text-sm font-medium transition-colors ' +
              (tab === id
                ? 'bg-brand-50 text-brand-700'
                : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
            }
          >
            {t(`reports.tabs.${id}`)}
          </button>
        ))}
      </div>

      <div className="card p-3">
        {tab === 'inventory' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              id="inv-category"
              label={t('products.category')}
              value={inventoryQ.category ?? ''}
              onChange={(e) => {
                setInventoryQ((q) => ({ ...q, category: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <SiteSelect
              sites={sites}
              value={inventoryQ.siteId ?? ''}
              onChange={(siteId) => {
                setInventoryQ((q) => ({ ...q, siteId: siteId || undefined }));
                setPage(1);
              }}
            />
            <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!inventoryQ.lowStockOnly}
                onChange={(e) => {
                  setInventoryQ((q) => ({ ...q, lowStockOnly: e.target.checked || undefined }));
                  setPage(1);
                }}
              />
              {t('reports.lowStockOnly')}
            </label>
          </div>
        )}

        {tab === 'expiry' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Input
              id="exp-days"
              label={t('reports.daysAhead')}
              type="number"
              min={1}
              value={String(expiryQ.days ?? 30)}
              onChange={(e) => {
                setExpiryQ((q) => ({ ...q, days: Number(e.target.value) || 30 }));
                setPage(1);
              }}
            />
            <Input
              id="exp-from"
              label={t('reports.fromOptional')}
              type="date"
              value={expiryQ.dateFrom?.slice(0, 10) ?? ''}
              onChange={(e) => {
                setExpiryQ((q) => ({ ...q, dateFrom: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <Input
              id="exp-to"
              label={t('reports.toOptional')}
              type="date"
              value={expiryQ.dateTo?.slice(0, 10) ?? ''}
              onChange={(e) => {
                setExpiryQ((q) => ({ ...q, dateTo: e.target.value || undefined }));
                setPage(1);
              }}
            />
          </div>
        )}

        {tab === 'sales' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SiteSelect
              sites={sites}
              value={salesQ.siteId ?? ''}
              onChange={(siteId) => {
                setSalesQ((q) => ({ ...q, siteId: siteId || undefined }));
                setPage(1);
              }}
            />
            <Input
              id="sales-from"
              label={t('orders.from')}
              type="date"
              value={salesQ.dateFrom?.slice(0, 10) ?? ''}
              onChange={(e) => {
                setSalesQ((q) => ({ ...q, dateFrom: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <Input
              id="sales-to"
              label={t('orders.to')}
              type="date"
              value={salesQ.dateTo?.slice(0, 10) ?? ''}
              onChange={(e) => {
                setSalesQ((q) => ({ ...q, dateTo: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <div>
              <label className="label">{t('reports.groupBy')}</label>
              <select
                className="input"
                value={salesQ.groupBy ?? 'site'}
                onChange={(e) => {
                  setSalesQ((q) => ({ ...q, groupBy: e.target.value as SalesGroupBy }));
                  setPage(1);
                }}
              >
                <option value="site">{t('reports.groupSite')}</option>
                <option value="product">{t('reports.groupProduct')}</option>
                <option value="day">{t('reports.groupDay')}</option>
              </select>
            </div>
          </div>
        )}

        {tab === 'sync' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SiteSelect
              sites={sites}
              value={syncQ.siteId ?? ''}
              onChange={(siteId) => {
                setSyncQ((q) => ({ ...q, siteId: siteId || undefined }));
                setPage(1);
              }}
            />
            <Input
              id="sync-type"
              label={t('reports.syncType')}
              placeholder="product_push, order_pull…"
              value={syncQ.syncType ?? ''}
              onChange={(e) => {
                setSyncQ((q) => ({ ...q, syncType: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <div>
              <label className="label">{t('orders.status')}</label>
              <select
                className="input"
                value={syncQ.status ?? ''}
                onChange={(e) => {
                  setSyncQ((q) => ({ ...q, status: e.target.value || undefined }));
                  setPage(1);
                }}
              >
                <option value="">{t('common.all')}</option>
                <option value="success">{t('syncStatus.success')}</option>
                <option value="partial">{t('syncStatus.partial')}</option>
                <option value="failed">{t('syncStatus.failed')}</option>
              </select>
            </div>
          </div>
        )}

        {tab === 'customers' && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SiteSelect
              sites={sites}
              value={customersQ.siteId ?? ''}
              onChange={(siteId) => {
                setCustomersQ((q) => ({ ...q, siteId: siteId || undefined }));
                setPage(1);
              }}
            />
            <Input
              id="cust-search"
              label={t('products.search')}
              placeholder={t('reports.searchPlaceholder')}
              value={customersQ.search ?? ''}
              onChange={(e) => {
                setCustomersQ((q) => ({ ...q, search: e.target.value || undefined }));
                setPage(1);
              }}
            />
            <div>
              <label className="label">{t('reports.sortBy')}</label>
              <select
                className="input"
                value={customersQ.sortBy ?? 'totalSpent'}
                onChange={(e) => {
                  setCustomersQ((q) => ({
                    ...q,
                    sortBy: e.target.value as CustomersReportQuery['sortBy'],
                  }));
                  setPage(1);
                }}
              >
                <option value="totalSpent">{t('reports.sortSpent')}</option>
                <option value="totalOrdersCount">{t('reports.sortOrders')}</option>
                <option value="name">{t('reports.sortName')}</option>
                <option value="createdAt">{t('reports.sortCreated')}</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {activeQ.isError && (
        <div className="card p-4 text-sm text-rose-600">
          {t('reports.loadFailed', { message: toApiError(activeQ.error).message })}
        </div>
      )}

      <div className="card overflow-x-auto">
        {activeQ.isLoading ? (
          <div className="flex justify-center p-8">
            <Spinner className="h-6 w-6" />
          </div>
        ) : tab === 'inventory' ? (
          <ReportTable
            headers={[
              t('reports.sku'),
              t('reports.product'),
              t('products.category'),
              t('reports.stock'),
              t('reports.threshold'),
              t('reports.statusCol'),
            ]}
            rows={(inventoryListQ.data?.data ?? []).map((r) => [
              r.skuMaster,
              r.name,
              r.category ?? t('common.emDash'),
              String(r.totalStock),
              String(r.lowStockThreshold),
              r.isLowStock ? (
                <Badge tone="red">{t('common.low')}</Badge>
              ) : (
                <Badge tone="green">{t('common.ok')}</Badge>
              ),
            ])}
            empty={t('reports.emptyInventory')}
          />
        ) : tab === 'expiry' ? (
          <ReportTable
            headers={[
              t('reports.sku'),
              t('reports.product'),
              t('reports.stock'),
              t('reports.expiryCol'),
              t('reports.daysLeft'),
            ]}
            rows={(expiryListQ.data?.data ?? []).map((r) => [
              r.skuMaster,
              r.name,
              String(r.totalStock),
              r.expiryDate ? formatDate(r.expiryDate) : t('common.emDash'),
              r.daysUntilExpiry != null ? (
                <Badge tone={r.daysUntilExpiry <= 7 ? 'red' : 'amber'}>
                  {t('dashboard.daysLeft', { days: r.daysUntilExpiry })}
                </Badge>
              ) : (
                t('common.emDash')
              ),
            ])}
            empty={t('reports.emptyExpiry')}
          />
        ) : tab === 'sales' ? (
          <SalesTable data={salesListQ.data} />
        ) : tab === 'sync' ? (
          <ReportTable
            headers={[t('reports.when'), t('orders.site'), t('reports.type'), t('orders.status')]}
            rows={(syncListQ.data?.data ?? []).map((r) => [
              formatDateTime(r.createdAt),
              r.siteName,
              r.syncType,
              <Badge tone={SYNC_STATUS_TONE[r.status] ?? 'gray'}>
                {t(`syncStatus.${r.status}`, r.status)}
              </Badge>,
            ])}
            empty={t('reports.emptySync')}
          />
        ) : (
          <ReportTable
            headers={[
              t('reports.customer'),
              t('orders.site'),
              t('reports.ordersCol'),
              t('reports.totalSpent'),
            ]}
            rows={(customersListQ.data?.data ?? []).map((r) => [
              <span>
                {r.name}
                {r.email && <span className="ms-1 text-slate-400">· {r.email}</span>}
              </span>,
              r.siteName ?? t('common.emDash'),
              String(r.totalOrdersCount),
              formatMoney(r.totalSpent),
            ])}
            empty={t('reports.emptyCustomers')}
          />
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {t('common.pageOfTotal', { page, totalPages })}
            {activeQ.data && 'total' in activeQ.data
              ? t('common.rowCount', { count: activeQ.data.total })
              : ''}
          </span>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t('common.previous')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function SiteSelect({
  sites,
  value,
  onChange,
}: {
  sites: { id: string; name: string }[];
  value: string;
  onChange: (siteId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <label className="label">{t('orders.site')}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t('common.allSites')}</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReportTable({
  headers,
  rows,
  empty,
}: {
  headers: string[];
  rows: ReactNode[][];
  empty: string;
}) {
  if (rows.length === 0) {
    return <p className="p-6 text-sm text-slate-500">{empty}</p>;
  }
  return (
    <table className="min-w-full text-sm">
      <thead>
        <tr className="border-b border-slate-100 bg-slate-50 text-start text-xs uppercase tracking-wide text-slate-500">
          {headers.map((h) => (
            <th key={h} className="px-4 py-3 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((row, i) => (
          <tr key={i} className="text-slate-700">
            {row.map((cell, j) => (
              <td key={j} className="px-4 py-2.5">
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SalesTable({ data }: { data: import('../lib/types').SalesReportResult | undefined }) {
  const { t } = useTranslation();

  if (!data || data.data.length === 0) {
    return <p className="p-6 text-sm text-slate-500">{t('reports.emptySales')}</p>;
  }
  if (data.groupBy === 'site') {
    return (
      <ReportTable
        headers={[t('orders.site'), t('reports.ordersCol'), t('reports.revenue')]}
        rows={(data.data as import('../lib/types').SalesSiteRow[]).map((r) => [
          r.siteName,
          String(r.orderCount),
          formatMoney(r.revenue),
        ])}
        empty=""
      />
    );
  }
  if (data.groupBy === 'product') {
    return (
      <ReportTable
        headers={[
          t('reports.sku'),
          t('reports.product'),
          t('reports.ordersCol'),
          t('reports.units'),
          t('reports.revenue'),
        ]}
        rows={(data.data as import('../lib/types').SalesProductRow[]).map((r) => [
          r.skuMaster ?? t('common.emDash'),
          r.productName ?? t('common.unknown'),
          String(r.orderCount),
          String(r.unitsSold),
          formatMoney(r.revenue),
        ])}
        empty=""
      />
    );
  }
  return (
    <ReportTable
      headers={[t('reports.day'), t('reports.ordersCol'), t('reports.revenue')]}
      rows={(data.data as import('../lib/types').SalesDayRow[]).map((r) => [
        r.day,
        String(r.orderCount),
        formatMoney(r.revenue),
      ])}
      empty=""
    />
  );
}

function formatMoney(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return n.toFixed(2);
}
