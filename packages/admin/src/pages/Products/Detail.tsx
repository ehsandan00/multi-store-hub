import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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
import { ProductHubPhoto } from '../../components/products/ProductHubPhoto';
import { daysUntil, formatDateTime, formatDate } from '../../lib/utils';

const REASON_TONE: Record<string, 'green' | 'amber' | 'blue' | 'gray'> = {
  IMPORT: 'blue',
  MANUAL_ADJUSTMENT: 'amber',
  SALE: 'green',
  SYNC: 'gray',
};

export function ProductDetail() {
  const { t } = useTranslation();
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
      toast.success(t('products.deletedSuccess'));
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error(t('products.deleteFailed'), toApiError(err).message),
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
          {t('products.loadProductFailed', {
            message: productQ.error ? toApiError(productQ.error).message : t('products.notFound'),
          })}
        </p>
        <Link to="/products" className="mt-3 inline-block text-sm text-brand-600 hover:underline">
          {t('products.backToProducts')}
        </Link>
      </div>
    );
  }

  const p = productQ.data;
  const stock = p.totalStock ?? 0;
  const low = stock <= p.lowStockThreshold && p.lowStockThreshold > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <Link to="/products" className="text-xs text-slate-500 hover:underline">
            {t('products.backToProducts')}
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold text-slate-900 sm:text-2xl">
            {p.name}
          </h1>
          <p className="mt-0.5 font-mono text-xs text-slate-500">{p.skuMaster}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(canMutate || canEditStock) && (
            <Button variant="secondary" onClick={() => setEditOpen(true)} type="button">
              {t('common.edit')}
            </Button>
          )}
          {canMutate && (
            <Button
              variant="ghost"
              className="text-rose-600 hover:bg-rose-50"
              onClick={() => setConfirmDelete(true)}
              type="button"
            >
              {t('common.delete')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <ProductHubPhoto
            productId={p.id}
            hasHubPhoto={p.hasHubPhoto}
            canEdit={canMutate || canEditStock}
          />
        </Card>

        <Card className="p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('products.details')}</h2>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            <Field label={t('products.description')} value={p.description || t('common.emDash')} />
            <Field label={t('products.category')} value={p.category || t('common.emDash')} />
            <Field label={t('products.barcode')} value={p.barcode || t('common.emDash')} />
            <Field label={t('products.basePrice')} value={p.basePrice} />
            <Field label={t('products.imageUrl')} value={p.imageUrl || t('common.emDash')} />
            <Field label={t('products.created')} value={formatDateTime(p.createdAt)} />
            <Field label={t('products.updated')} value={formatDateTime(p.updatedAt)} />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('products.inventory')}</h2>
          <div className="space-y-3">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{t('products.currentStock')}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{p.totalStock}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">{t('products.lowStockThreshold')}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{p.lowStockThreshold}</p>
              {low ? (
                <Badge tone="amber" className="mt-2">
                  {t('products.belowThreshold')}
                </Badge>
              ) : (
                <Badge tone="green" className="mt-2">
                  {t('common.ok')}
                </Badge>
              )}
            </div>
          </div>
        </Card>
      </div>

      {(p.expiryBatches ?? []).length > 0 && (
        <Card className="p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('products.expiryBatches')}</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('products.expiryDate')}</th>
                  <th className="text-end">{t('products.batchQuantity')}</th>
                  <th>{t('products.status')}</th>
                </tr>
              </thead>
              <tbody>
                {(p.expiryBatches ?? []).map((batch) => {
                  const batchDays = daysUntil(batch.expiryDate);
                  return (
                    <tr key={batch.id}>
                      <td>{formatDate(batch.expiryDate)}</td>
                      <td className="text-end tabular-nums">{batch.quantity}</td>
                      <td>
                        {batchDays !== null && batchDays < 0 ? (
                          <Badge tone="red">{t('products.expired')}</Badge>
                        ) : batchDays !== null && batchDays <= 30 ? (
                          <Badge tone={batchDays <= 7 ? 'red' : 'amber'}>
                            {t('products.daysLeft', { days: batchDays })}
                          </Badge>
                        ) : (
                          <Badge tone="green">{t('common.ok')}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-900">{t('products.inventoryHistory')}</h2>
        {historyQ.isLoading ? (
          <Spinner className="h-5 w-5" />
        ) : historyQ.isError ? (
          <p className="text-sm text-rose-600">{t('products.loadHistoryFailed')}</p>
        ) : historyQ.data && historyQ.data.length > 0 ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('products.historyDate')}</th>
                  <th>{t('products.historyReason')}</th>
                  <th className="text-end">{t('products.historyChange')}</th>
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
                        'text-end tabular-nums font-medium ' +
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
          <p className="text-sm text-slate-500">{t('products.noHistory')}</p>
        )}
      </Card>

      {editOpen && <ProductFormModal open onClose={() => setEditOpen(false)} initial={p} />}

      <ConfirmDialog
        open={confirmDelete}
        title={t('products.deleteTitle')}
        message={t('products.deleteConfirmPermanent', { name: p.name })}
        confirmLabel={t('common.delete')}
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
