import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersApi, sitesApi, toApiError } from '../../lib/api';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { Modal } from '../../components/ui/Modal';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { formatDateTime, formatDate } from '../../lib/utils';
import type { OrderRow, OrderDetail, ListOrdersQuery } from '../../lib/types';

const STATUS_TONE: Record<string, 'gray' | 'green' | 'red' | 'amber' | 'blue'> = {
  completed: 'green',
  processing: 'blue',
  on_hold: 'amber',
  pending: 'amber',
  cancelled: 'red',
  refunded: 'red',
  failed: 'red',
};

const STATUS_OPTIONS = ['', 'pending', 'processing', 'on_hold', 'completed', 'cancelled', 'refunded'];

export function OrdersList() {
  const [search, setSearch] = useState('');
  const [siteId, setSiteId] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const pageSize = 25;

  const debouncedSearch = useDebouncedValue(search, 300);

  const query: ListOrdersQuery = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      siteId: siteId || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      page,
      pageSize,
    }),
    [debouncedSearch, siteId, status, dateFrom, dateTo, page, pageSize],
  );

  const listQ = useQuery({
    queryKey: ['orders', query],
    queryFn: () => ordersApi.list(query),
    placeholderData: (prev) => prev,
  });
  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
    staleTime: 60_000,
  });

  function resetFilters() {
    setSearch('');
    setSiteId('');
    setStatus('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const total = listQ.data?.total ?? 0;
  const totalPages = listQ.data?.totalPages ?? 1;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Aggregated order book across all connected stores. Pulled from WooCommerce via the Sync page.
        </p>
      </div>

      {/* Filters */}
      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          id="orders-search"
          label="Search"
          placeholder="Order #, customer name, email…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div>
          <label className="label">Site</label>
          <select
            className="input"
            value={siteId}
            onChange={(e) => {
              setSiteId(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All sites</option>
            {(sitesQ.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(1);
            }}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s === '' ? 'All statuses' : s}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            id="orders-date-from"
            label="From"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
          />
          <Input
            id="orders-date-to"
            label="To"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="flex items-end justify-end gap-2 lg:col-span-4">
          <Button variant="secondary" onClick={resetFilters} type="button">
            Reset
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Order #</th>
              <th>Site</th>
              <th>Customer</th>
              <th>Status</th>
              <th className="text-right">Total</th>
              <th>Date</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.isError && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-rose-600">
                  Failed to load orders: {toApiError(listQ.error).message}
                </td>
              </tr>
            )}
            {listQ.data?.data.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  No orders match these filters. Pull orders from a site on the Sync page.
                </td>
              </tr>
            )}
            {listQ.data?.data.map((o) => (
              <OrderRowItem key={o.id} order={o} onClick={() => setSelectedId(o.id)} />
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500">
            {((page - 1) * pageSize) + 1}–{Math.min(page * pageSize, total)} of {total}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              type="button"
            >
              Prev
            </Button>
            <span className="px-2 py-1 text-slate-600">
              {page} / {totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              type="button"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <OrderDetailModal orderId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}

function OrderRowItem({ order, onClick }: { order: OrderRow; onClick: () => void }) {
  const tone = STATUS_TONE[order.status] ?? 'gray';
  return (
    <tr className="cursor-pointer hover:bg-slate-50" onClick={onClick}>
      <td className="font-mono text-xs">{order.orderNumber}</td>
      <td className="text-slate-700">{order.site?.name ?? '—'}</td>
      <td className="text-slate-700">{order.billingName ?? order.customer?.name ?? '—'}</td>
      <td>
        <Badge tone={tone}>{order.status}</Badge>
      </td>
      <td className="text-right font-medium text-slate-900">
        {formatMoney(order.totalAmount, order.currency)}
      </td>
      <td className="text-slate-500">{formatDate(order.dateCreated ?? order.createdAt)}</td>
    </tr>
  );
}

function OrderDetailModal({ orderId, onClose }: { orderId: string | null; onClose: () => void }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['orders', 'detail', orderId],
    queryFn: () => ordersApi.get(orderId!),
    enabled: !!orderId,
  });

  return (
    <Modal
      open={!!orderId}
      onClose={onClose}
      title={data ? `Order #${data.orderNumber}` : 'Order'}
      description={data ? `${data.site?.name ?? '—'} · ${data.status}` : undefined}
      size="lg"
    >
      {isLoading && <Spinner className="h-5 w-5" />}
      {isError && (
        <p className="text-sm text-rose-600">Failed to load order: {toApiError(error).message}</p>
      )}
      {data && <OrderDetailBody order={data} />}
    </Modal>
  );
}

function OrderDetailBody({ order }: { order: OrderDetail }) {
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <DetailField label="Status" value={<Badge tone={STATUS_TONE[order.status] ?? 'gray'}>{order.status}</Badge>} />
        <DetailField label="Total" value={formatMoney(order.totalAmount, order.currency)} />
        <DetailField label="Payment method" value={order.paymentMethod ?? '—'} />
        <DetailField label="Discount" value={formatMoney(order.discountTotal, order.currency)} />
        <DetailField label="Shipping" value={formatMoney(order.shippingTotal, order.currency)} />
        <DetailField label="Date created" value={formatDateTime(order.dateCreated ?? order.createdAt)} />
        <DetailField label="Billing name" value={order.billingName ?? '—'} />
        <DetailField label="Billing email" value={order.billingEmail ?? '—'} />
        <DetailField label="Billing phone" value={order.billingPhone ?? '—'} />
        <DetailField label="Customer" value={order.customer?.name ?? '—'} />
        <DetailField label="Remote order ID" value={order.remoteOrderId ?? '—'} />
        <DetailField label="Site" value={order.site?.name ?? '—'} />
      </div>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Line items</h3>
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">SKU</th>
                <th className="px-3 py-2 text-left">Linked product</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2 text-right">Unit price</th>
                <th className="px-3 py-2 text-right">Line total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {order.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-slate-400">
                    No line items recorded.
                  </td>
                </tr>
              )}
              {order.items.map((it) => (
                <tr key={it.id}>
                  <td className="px-3 py-2 text-slate-800">{it.lineName ?? '—'}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{it.siteSku ?? '—'}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {it.product ? `${it.product.name} (${it.product.skuMaster})` : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">{it.quantity}</td>
                  <td className="px-3 py-2 text-right">{formatMoney(it.unitPrice, order.currency)}</td>
                  <td className="px-3 py-2 text-right font-medium">
                    {formatMoney(lineTotal(it), order.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DetailField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-slate-800">{value}</p>
    </div>
  );
}

function lineTotal(item: { quantity: number; unitPrice: string }): string {
  const qty = item.quantity;
  const price = Number(item.unitPrice);
  if (!Number.isFinite(price)) return item.unitPrice;
  return (qty * price).toFixed(2);
}

function formatMoney(amount: string, currency?: string | null): string {
  const n = Number(amount);
  const cur = currency && currency.length <= 3 ? currency : '';
  if (!Number.isFinite(n)) return amount;
  const formatted = n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return cur ? `${formatted} ${cur}` : formatted;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}
