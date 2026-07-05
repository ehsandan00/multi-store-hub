import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, toApiError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Card } from '../../components/ui/Card';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProductFormModal } from './Form';
import { daysUntil, formatDateTime, formatDate } from '../../lib/utils';

const REASON_TONE: Record<string, 'green' | 'amber' | 'blue' | 'gray'> = {
  IMPORT: 'blue',
  MANUAL_ADJUSTMENT: 'amber',
  SALE: 'green',
  SYNC: 'gray',
};

export function ProductDetail() {
  const { id = '' } = useParams();
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const canMutate = user?.role === 'ADMIN';
  const canEditStock = user?.role === 'ADMIN' || user?.role === 'WAREHOUSE_STAFF';

  const productQ = useQuery({ queryKey: ['products', id], queryFn: () => productsApi.get(id) });
  const historyQ = useQuery({
    queryKey: ['products', id, 'inventory-history'],
    queryFn: () => productsApi.inventoryHistory(id),
  });

  const [editOpen, setEditOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteMut = useMutation({
    mutationFn: () => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Product deleted');
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error('Failed to delete', toApiError(err).message),
  });

  if (productQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (productQ.isError || !productQ.data) {
    return (
      <div className="card p-6 text-center">
        <p className="text-sm text-rose-600">
          Failed to load product: {productQ.error ? toApiError(productQ.error).message : 'not found'}
        </p>
        <Link to="/products" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          ← Back to products
        </Link>
      </div>
    );
  }

  const p = productQ.data;
  const d = daysUntil(p.expiryDate);
  const low = p.totalStock <= p.lowStockThreshold && p.lowStockThreshold > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/products" className="text-xs text-slate-500 hover:underline">
            ← Products
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold text-slate-900 sm:text-2xl">
            {p.name}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{p.skuMaster}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(canMutate || canEditStock) && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} type="button">
              Edit
            </Button>
          )}
          {canMutate && (
            <Button
              variant="ghost"
              className="text-rose-600 hover:bg-rose-50"
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Details</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label="Description" value={p.description || '—'} />
            <Field label="Category" value={p.category || '—'} />
            <Field label="Barcode" value={p.barcode || '—'} />
            <Field label="Base price" value={p.basePrice} />
            <Field
              label="Expiry date"
              value={
                p.expiryDate ? (
                  <span className="inline-flex items-center gap-2">
                    {formatDate(p.expiryDate)}
                    {d !== null && d >= 0 && d <= 30 && (
                      <Badge tone={d <= 7 ? 'red' : 'amber'}>{d}d left</Badge>
                    )}
                    {d !== null && d < 0 && <Badge tone="red">expired</Badge>}
                  </span>
                ) : (
                  '—'
                )
              }
            />
            <Field label="Image URL" value={p.imageUrl || '—'} />
            <Field label="Created" value={formatDateTime(p.createdAt)} />
            <Field label="Updated" value={formatDateTime(p.updatedAt)} />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">Inventory</h2>
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Current stock</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{p.totalStock}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Low-stock threshold</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{p.lowStockThreshold}</p>
              {low ? (
                <Badge tone="amber" className="mt-2">Below threshold</Badge>
              ) : (
                <Badge tone="green" className="mt-2">OK</Badge>
              )}
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">Inventory history</h2>
        {historyQ.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : historyQ.isError ? (
          <p className="text-sm text-rose-600">Failed to load history</p>
        ) : historyQ.data && historyQ.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Reason</th>
                  <th className="text-right">Change</th>
                </tr>
              </thead>
              <tbody>
                {historyQ.data.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.createdAt)}</td>
                    <td>
                      <Badge tone={REASON_TONE[log.reason] ?? 'gray'}>
                        {log.reason.replace(/_/g, ' ').toLowerCase()}
                      </Badge>
                    </td>
                    <td
                      className={
                        'text-right tabular-nums font-medium ' +
                        (log.changeAmount >= 0 ? 'text-emerald-700' : 'text-rose-700')
                      }
                    >
                      {log.changeAmount > 0 ? '+' : ''}
                      {log.changeAmount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No inventory changes recorded yet.</p>
        )}
      </Card>

      {editOpen && <ProductFormModal open onClose={() => setEditOpen(false)} initial={p} />}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete product"
        message={
          <>
            Delete <strong>{p.name}</strong>? This is permanent and audited.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteMut.mutate()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}
