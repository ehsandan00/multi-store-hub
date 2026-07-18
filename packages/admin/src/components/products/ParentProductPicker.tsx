import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../lib/api';
import type { ProductRow } from '../../lib/types';
import { Spinner } from '../ui/Spinner';
import { cn } from '../../lib/utils';

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

interface Props {
  value: string | null;
  selectedLabel?: string | null;
  onChange: (id: string | null, product?: ProductRow) => void;
  error?: string;
  excludeId?: string;
  disabled?: boolean;
}

export function ParentProductPicker({
  value,
  selectedLabel,
  onChange,
  error,
  excludeId,
  disabled,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const rootRef = useRef<HTMLDivElement>(null);

  const listQ = useQuery({
    queryKey: ['products', 'parent-pick', debouncedSearch],
    queryFn: () =>
      productsApi.list({
        search: debouncedSearch.trim() || undefined,
        productType: 'VARIABLE',
        page: 1,
        pageSize: 25,
      }),
    enabled: open && !disabled,
  });

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const options = (listQ.data?.data ?? []).filter((p) => p.id !== excludeId);

  return (
    <div ref={rootRef} className="relative">
      <label className="label" htmlFor="parent-product-search">
        {t('products.parentProduct')}
        <span className="ms-0.5 text-rose-600">*</span>
      </label>
      <button
        id="parent-product-search"
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'input flex w-full items-center justify-between text-start',
          error && 'border-rose-400',
          disabled && 'cursor-not-allowed opacity-60',
        )}
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>
          {value
            ? selectedLabel ?? t('products.parentSelected')
            : t('products.parentProductPlaceholder')}
        </span>
        <span className="text-xs text-slate-400">{open ? '▲' : '▼'}</span>
      </button>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      {!error && <p className="mt-1 text-xs text-slate-500">{t('products.parentProductHint')}</p>}

      {open && !disabled && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              type="search"
              autoFocus
              className="input py-1.5 text-sm"
              placeholder={t('products.parentSearchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {listQ.isLoading && (
              <div className="flex justify-center py-4">
                <Spinner className="h-4 w-4" />
              </div>
            )}
            {!listQ.isLoading && options.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-slate-400">
                {t('products.parentProductEmpty')}
              </p>
            )}
            {options.map((p) => (
              <button
                key={p.id}
                type="button"
                className={cn(
                  'flex w-full flex-col rounded-md px-2 py-2 text-start text-sm hover:bg-slate-50',
                  value === p.id && 'bg-brand-50 text-brand-800',
                )}
                onClick={() => {
                  onChange(p.id, p);
                  setOpen(false);
                  setSearch('');
                }}
              >
                <span className="font-medium">{p.name}</span>
                <span className="font-mono text-xs text-slate-500">{p.skuMaster}</span>
              </button>
            ))}
          </div>
          {value && (
            <div className="border-t border-slate-100 p-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-xs text-rose-600 hover:bg-rose-50"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                {t('products.clearParent')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
