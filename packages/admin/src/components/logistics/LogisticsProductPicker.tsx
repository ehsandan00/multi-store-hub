import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../lib/api';
import type { ProductRow } from '../../lib/types';
import { Spinner } from '../ui/Spinner';

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

interface Props {
  onSelect: (product: ProductRow) => void;
  disabled?: boolean;
}

export function LogisticsProductPicker({ onSelect, disabled }: Props) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);

  const query = useQuery({
    queryKey: ['products', 'logistics-picker', debounced],
    queryFn: () =>
      productsApi.list({
        search: debounced.trim() || undefined,
        view: 'hub',
        page: 1,
        pageSize: 20,
      }),
    enabled: open && !disabled,
  });

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  function choose(product: ProductRow) {
    onSelect(product);
    setSearch('');
    setOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor="logistics-product-search" className="label">
        {t('logistics.productSearch')}
      </label>
      <input
        ref={inputRef}
        id="logistics-product-search"
        type="search"
        disabled={disabled}
        className="input"
        value={search}
        placeholder={t('logistics.productSearchPlaceholder')}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setSearch(event.target.value);
          setOpen(true);
        }}
      />

      {open && !disabled && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg">
          {query.isLoading && (
            <div className="flex justify-center py-5">
              <Spinner className="h-5 w-5" />
            </div>
          )}
          {!query.isLoading && (query.data?.data.length ?? 0) === 0 && (
            <p className="px-3 py-4 text-center text-xs text-slate-400">
              {t('logistics.noProductFound')}
            </p>
          )}
          {query.data?.data.map((product) => (
            <button
              key={product.id}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-start hover:bg-slate-50"
              onClick={() => choose(product)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-slate-900">
                  {product.name}
                </span>
                <span className="block font-mono text-xs text-slate-500">
                  {product.skuMaster}
                  {product.barcode ? ` · ${product.barcode}` : ''}
                </span>
              </span>
              <span className="shrink-0 text-xs text-slate-500">
                {t('logistics.stockValue', { count: product.totalStock ?? 0 })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
