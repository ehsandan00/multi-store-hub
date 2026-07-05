import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { productsApi, toApiError } from '../../lib/api';
import { useAuthStore } from '../../lib/auth-store';
import { useToast } from '../../lib/toast';
import type { Role } from '../../lib/types';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { ProductFormModal } from './Form';
import { daysUntil, formatDate } from '../../lib/utils';

export function ProductsList() {
  const { user } = useAuthStore();
  const toast = useToast();
  const qc = useQueryClient();

  const canMutate = user?.role === 'ADMIN';
  const role: Role | undefined = user?.role;

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<null | { id: string; skuMaster: string; name: string }>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      category: category || undefined,
      lowStock: lowStockOnly || undefined,
      page,
      pageSize,
    }),
    [debouncedSearch, category, lowStockOnly, page, pageSize],
  );

  const listQ = useQuery({
    queryKey: ['products', query],
    queryFn: () => productsApi.list(query),
    placeholderData: (prev) => prev,
  });
  const catQ = useQuery({
    queryKey: ['products', 'categories'],
    queryFn: () => productsApi.categories(),
    staleTime: 60_000,
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => productsApi.remove(id),
    onSuccess: () => {
      toast.success('Product deleted');
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error('Failed to delete product', toApiError(err).message),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">Products</h1>
          <p className="mt-1 text-sm text-slate-500">
            Central catalog shared across all sites.{' '}
            {role === 'VIEWER' && 'You have read-only access.'}
          </p>
        </div>
        {canMutate && (
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + New product
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          id="search"
          label="Search"
          placeholder="Name, SKU, barcode…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {(catQ.data ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={lowStockOnly}
              onChange={(e) => {
                setLowStockOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            Low stock only
          </label>
        </div>
        <div className="flex items-end justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setSearch('');
              setCategory('');
              setLowStockOnly(false);
              setPage(1);
            }}
            type="button"
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Name</th>
              <th>Category</th>
              <th className="text-right">Price</th>
              <th className="text-right">Stock</th>
              <th>Expiry</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {listQ.isLoading && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  <Spinner className="mx-auto h-5 w-5" />
                </td>
              </tr>
            )}
            {listQ.isError && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-rose-600">
                  Failed to load products: {toApiError(listQ.error).message}
                </td>
              </tr>
            )}
            {listQ.data?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-400">
                  No products match these filters.
                </td>
              </tr>
            )}
            {listQ.data?.data.map((p) => {
              const d = daysUntil(p.expiryDate);
              const low = p.totalStock <= p.lowStockThreshold && p.lowStockThreshold > 0;
              return (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.skuMaster}</td>
                  <td>
                    <Link
                      to={`/products/${p.id}`}
                      className="font-medium text-slate-900 hover:text-brand-700"
                    >
                      {p.name}
                    </Link>
                  </td>
                  <td>{p.category ?? '—'}</td>
                  <td className="text-right tabular-nums">{p.basePrice}</td>
                  <td className="text-right">
                    <span className="tabular-nums">{p.totalStock}</span>
                    {low && <Badge tone="amber" className="ml-2">low</Badge>}
                  </td>
                  <td>
                    {p.expiryDate ? (
                      <span className="inline-flex items-center gap-1.5">
                        {formatDate(p.expiryDate)}
                        {d !== null && d <= 30 && d >= 0 && (
                          <Badge tone={d <= 7 ? 'red' : 'amber'}>{d}d</Badge>
                        )}
                        {d !== null && d < 0 && <Badge tone="red">expired</Badge>}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Link
                        to={`/products/${p.id}`}
                        className="btn-ghost px-3 py-1.5 text-xs"
                      >
                        View
                      </Link>
                      {canMutate && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setEditing({ id: p.id, skuMaster: p.skuMaster, name: p.name })
                          }
                          type="button"
                        >
                          Edit
                        </Button>
                      )}
                      {canMutate && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600 hover:bg-rose-50"
                          onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                          type="button"
                        >
                          Delete
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

      {/* Pagination */}
      {listQ.data && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
          <p>
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, listQ.data.total)} of{' '}
            {listQ.data.total}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              type="button"
            >
              Prev
            </Button>
            <span className="px-2">
              {page} / {listQ.data.totalPages}
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= listQ.data.totalPages}
              onClick={() => setPage((p) => p + 1)}
              type="button"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Create modal — always renders with empty form when no editing target */}
      {formOpen && !editing && (
        <ProductFormModal open={formOpen} onClose={() => setFormOpen(false)} />
      )}

      {/* Edit modal — fetches product and renders form. We use a loader wrapper here. */}
      {formOpen && editing && (
        <EditProductLoader id={editing.id} onClose={() => setFormOpen(false)} />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete product"
        message={
          <>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action is
            audited and cannot be undone.
          </>
        }
        confirmLabel="Delete"
        destructive
        loading={deleteMut.isPending}
        onConfirm={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

// ─── Edit loader: fetches the product, then opens the modal with full data ───
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

// ─── helpers ──────────────────────────────────────────────────────────────────
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return v;
}
