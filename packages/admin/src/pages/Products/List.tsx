import { useState, useMemo, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, sitesApi, toApiError } from '../../lib/api';
import { pickOcrSearchQueries } from '../../lib/ocr';
import { resolveProductScan, type ScanSource } from '../../lib/product-scan';
import { useAuthStore } from '../../lib/auth-store';
import { useToast } from '../../lib/toast';
import type { Role } from '../../lib/types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProductFormModal } from './Form';
import { ProductPhotoThumb } from '../../components/products/ProductPhotoThumb';
import { BarcodeScannerModal } from '../../components/products/BarcodeScannerModal';
import { daysUntil, formatDate } from '../../lib/utils';

export function ProductsList() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const canMutate = user?.role === 'ADMIN';
  const role: Role | undefined = user?.role;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [catalogView, setCatalogView] = useState<'hub' | 'all' | string>('hub');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id: string; skuMaster: string; name: string }>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [createPrefill, setCreatePrefill] = useState<{ skuMaster: string; barcode: string } | null>(
    null,
  );

  useEffect(() => {
    if (searchParams.get('lowStock') === '1') {
      setLowStockOnly(true);
    }
    const q = searchParams.get('search');
    if (q) {
      setSearch(q);
      setPage(1);
    }
    if (searchParams.get('create') === '1' && canMutate) {
      setEditing(null);
      setCreatePrefill(null);
      setFormOpen(true);
      navigate('/products', { replace: true });
    }
  }, [searchParams, canMutate, navigate]);

  const debouncedSearch = useDebouncedValue(search, 300);
  const isHubView = catalogView === 'hub';

  const query = useMemo(() => {
    const base = {
      search: debouncedSearch || undefined,
      category: category || undefined,
      lowStock: isHubView && lowStockOnly ? true : undefined,
      page,
      pageSize,
    };
    if (catalogView === 'hub') return { ...base, view: 'hub' as const };
    if (catalogView === 'all') return { ...base, view: 'all' as const };
    return { ...base, view: 'site' as const, siteId: catalogView };
  }, [debouncedSearch, category, lowStockOnly, page, pageSize, catalogView, isHubView]);

  const listQ = useQuery({
    queryKey: ['products', query],
    queryFn: () => productsApi.list(query),
    placeholderData: (prev) => prev,
  });
  const sitesQ = useQuery({
    queryKey: ['sites', { page: 1, pageSize: 100 }],
    queryFn: () => sitesApi.list(1, 100),
    staleTime: 60_000,
  });
  const catQ = useQuery({
    queryKey: ['products', 'categories'],
    queryFn: () => productsApi.categories(),
    staleTime: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      toast.success(t('products.deletedSuccess'));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error(t('products.deleteFailed'), toApiError(err).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">{t('products.title')}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {t('products.subtitle')}{' '}
            {role === 'VIEWER' && t('common.readOnly')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" type="button" onClick={() => setScanOpen(true)}>
            {t('products.scanBarcode')}
          </Button>
          {canMutate && (
            <Button
              onClick={() => {
                setEditing(null);
                setCreatePrefill(null);
                setFormOpen(true);
              }}
            >
              {t('products.newProduct')}
            </Button>
          )}
        </div>
      </div>

      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="sm:col-span-2 lg:col-span-1">
          <label className="label" htmlFor="catalogView">
            {t('products.catalogSource')}
          </label>
          <select
            id="catalogView"
            className="input"
            value={catalogView}
            onChange={(e) => {
              setCatalogView(e.target.value);
              setPage(1);
            }}
          >
            <option value="hub">{t('products.catalogHub')}</option>
            <option value="all">{t('products.catalogAll')}</option>
            {(sitesQ.data?.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {t('products.catalogSiteOption', { name: s.name })}
              </option>
            ))}
          </select>
        </div>
        <Input
          id="search"
          label={t('products.search')}
          placeholder={t('products.searchPlaceholder')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div>
          <label className="label">{t('products.category')}</label>
          <select
            className="input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">{t('common.all')}</option>
            {(catQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label
            className={`flex items-center gap-2 text-sm ${isHubView ? 'text-slate-700' : 'text-slate-400'}`}
          >
            <input
              type="checkbox"
              checked={lowStockOnly}
              disabled={!isHubView}
              onChange={(e) => {
                setLowStockOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500 disabled:opacity-50"
            />
            {t('products.lowStockOnly')}
          </label>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSearch('');
              setCategory('');
              setLowStockOnly(false);
              setCatalogView('hub');
              setPage(1);
            }}
            type="button"
          >
            {t('common.reset')}
          </Button>
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('products.photo')}</th>
              <th>{t('products.sku')}</th>
              <th>{t('products.name')}</th>
              {!isHubView && <th>{t('products.source')}</th>}
              {!isHubView && <th>{t('products.siteSku')}</th>}
              <th>{t('products.category')}</th>
              <th className="text-end">{t('products.price')}</th>
              <th className="text-end">{t('products.stock')}</th>
              <th>{t('products.expiry')}</th>
              <th className="text-end">{t('products.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={isHubView ? 8 : 10} className="py-8 text-center text-slate-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.isError && (
              <tr>
                <td colSpan={isHubView ? 8 : 10} className="py-6 text-center text-rose-600">
                  {t('products.loadFailed', { message: toApiError(listQ.error).message })}
                </td>
              </tr>
            )}
            {listQ.data?.data.length === 0 && (
              <tr>
                <td colSpan={isHubView ? 8 : 10} className="py-8 text-center text-slate-400">
                  {t('products.empty')}
                </td>
              </tr>
            )}
            {listQ.data?.data.map((p) => {
              const d = daysUntil(p.expiryDate);
              const low =
                isHubView &&
                p.totalStock !== null &&
                p.totalStock <= p.lowStockThreshold &&
                p.lowStockThreshold > 0;
              const isHubProduct = p.catalogKind !== 'SITE';
              const rowKey = p.rowKey ?? p.id;
              return (
                <tr key={rowKey}>
                  <td>
                    {isHubProduct ? (
                      <ProductPhotoThumb
                        productId={p.id}
                        hasHubPhoto={p.hasHubPhoto}
                        alt={p.name}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">{t('common.emDash')}</span>
                    )}
                  </td>
                  <td className="font-mono text-xs">{p.skuMaster}</td>
                  <td>
                    {isHubProduct ? (
                      <Link
                        to={`/products/${p.id}`}
                        className="font-medium text-slate-900 hover:text-brand-700"
                      >
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">{p.name}</span>
                    )}
                  </td>
                  {!isHubView && (
                    <td>
                      {p.catalogKind === 'SITE' ? (
                        <Badge tone="blue">{p.siteName ?? t('products.siteOnly')}</Badge>
                      ) : (
                        <Badge tone="green">{t('products.catalogHub')}</Badge>
                      )}
                    </td>
                  )}
                  {!isHubView && (
                    <td className="font-mono text-xs text-slate-600">
                      {p.siteSku ?? p.siteTitle ?? t('common.emDash')}
                    </td>
                  )}
                  <td>{p.category ?? t('common.emDash')}</td>
                  <td className="text-end tabular-nums">
                    {p.basePrice ? p.basePrice : t('common.emDash')}
                  </td>
                  <td className="text-end">
                    {p.totalStock !== null && p.totalStock !== undefined ? (
                      <>
                        <span className="tabular-nums">{p.totalStock}</span>
                        {low && (
                          <Badge tone="amber" className="ms-2">
                            {t('common.low')}
                          </Badge>
                        )}
                      </>
                    ) : (
                      t('common.emDash')
                    )}
                  </td>
                  <td>
                    {p.expiryDate ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatDate(p.expiryDate)}
                        {(p.expiryBatches ?? []).length > 1 && (
                          <Badge tone="blue">+{(p.expiryBatches ?? []).length - 1}</Badge>
                        )}
                        {d !== null && d <= 30 && d >= 0 && (
                          <Badge tone={d <= 7 ? 'red' : 'amber'}>
                            {t('dashboard.daysLeft', { days: d })}
                          </Badge>
                        )}
                        {d !== null && d < 0 && (
                          <Badge tone="red">{t('products.expired')}</Badge>
                        )}
                      </span>
                    ) : (
                      t('common.emDash')
                    )}
                  </td>
                  <td className="text-end">
                    <div className="flex items-center justify-end gap-1">
                      {isHubProduct && (
                        <Link
                          to={`/products/${p.id}`}
                          className="btn-ghost px-3 py-1.5 text-xs"
                        >
                          {t('common.view')}
                        </Link>
                      )}
                      {canMutate && isHubProduct && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setEditing({ id: p.id, skuMaster: p.skuMaster, name: p.name });
                            setFormOpen(true);
                          }}
                          type="button"
                        >
                          {t('common.edit')}
                        </Button>
                      )}
                      {canMutate && isHubProduct && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                          type="button"
                        >
                          {t('common.delete')}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {listQ.data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <p>
            {t('common.showingRange', {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, listQ.data.total),
              total: listQ.data.total,
            })}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              type="button"
            >
              {t('common.prev')}
            </Button>
            <span className="px-2">
              {t('common.pageOf', { page, totalPages: listQ.data.totalPages })}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= listQ.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}

      {formOpen && !editing && (
        <ProductFormModal
          open={formOpen}
          prefill={createPrefill ?? undefined}
          onClose={() => {
            setFormOpen(false);
            setCreatePrefill(null);
          }}
        />
      )}

      {formOpen && editing && (
        <EditProductLoader
          id={editing.id}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={t('products.deleteTitle')}
        message={t('products.deleteMessage', { name: deleteTarget?.name })}
        confirmLabel={t('common.delete')}
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />

      <BarcodeScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={async (value, meta) => {
          const source: ScanSource = meta?.source ?? 'barcode';
          if (source === 'ocr') {
            const result = await resolveProductScan(value, 'ocr');
            if (result.kind === 'product') {
              navigate(`/products/${result.product.id}`);
              return true;
            }
            if (result.kind === 'many') {
              navigate(`/products?search=${encodeURIComponent(result.query)}`);
              toast.info(t('scanFab.multipleMatches', { count: result.count }));
              return true;
            }
            const name = pickOcrSearchQueries(value)[0];
            if (name) {
              setSearch(name);
              setPage(1);
            }
            toast.info(t('products.scanNotFound'), name ?? value);
            return true;
          }

          try {
            const product = await productsApi.lookup(value);
            navigate(`/products/${product.id}`);
            return true;
          } catch {
            if (canMutate) {
              setCreatePrefill({ skuMaster: value, barcode: value });
              setEditing(null);
              setFormOpen(true);
              toast.success(t('products.scanFilled'));
            } else {
              setSearch(value);
              setPage(1);
              toast.info(t('products.scanNotFound'), value);
            }
            return true;
          }
        }}
      />
    </div>
  );
}

function EditProductLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['products', id], queryFn: () => productsApi.get(id) });
  if (q.isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (q.isError || !q.data) {
    return null;
  }
  return <ProductFormModal open onClose={onClose} initial={q.data} />;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState<T>(value);
  useEffect(() => {
    const timer = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return v;
}
