import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { productsApi } from '../lib/api';
import { useToast } from '../lib/toast';
import { useAuthStore } from '../lib/auth-store';
import { resolveProductScan, type ScanSource } from '../lib/product-scan';
import { BarcodeScannerModal } from './products/BarcodeScannerModal';
import { cn } from '../lib/utils';

export function ScanFab() {
  const { t } = useTranslation();
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const canCreate = user?.role === 'ADMIN';
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [menuOpen]);

  function openCreate() {
    setMenuOpen(false);
    if (!canCreate) {
      toast.error(t('scanFab.createForbidden'));
      return;
    }
    navigate('/products?create=1');
  }

  function openScan() {
    setMenuOpen(false);
    setScanOpen(true);
  }

  return (
    <div
      ref={menuRef}
      className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 md:start-auto md:end-8 md:translate-x-0"
    >
      {menuOpen && (
        <div className="absolute bottom-16 end-0 flex min-w-[12rem] flex-col gap-1 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
          <button
            type="button"
            disabled={!canCreate}
            onClick={openCreate}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
          >
            <span aria-hidden="true">➕</span>
            {t('scanFab.createProduct')}
          </button>
          <button
            type="button"
            onClick={openScan}
            className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-start text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            <span aria-hidden="true">📷</span>
            {t('scanFab.scanProduct')}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          'flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-2xl font-light text-white shadow-lg transition hover:bg-brand-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2',
          menuOpen && 'rotate-45',
        )}
        aria-label={t('scanFab.openMenu')}
        aria-expanded={menuOpen}
        title={t('scanFab.openMenu')}
      >
        +
      </button>

      <BarcodeScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={async (value, meta) => {
          const source: ScanSource = meta?.source ?? 'barcode';

          if (source === 'barcode') {
            try {
              const product = await productsApi.lookup(value);
              navigate(`/products/${product.id}`);
              return true;
            } catch {
              toast.error(t('scanFab.productNotFound'), value);
              return false;
            }
          }

          const result = await resolveProductScan(value, source);
          if (result.kind === 'product') {
            navigate(`/products/${result.product.id}`);
            return true;
          }
          if (result.kind === 'many') {
            navigate(`/products?search=${encodeURIComponent(result.query)}`);
            toast.info(t('scanFab.multipleMatches', { count: result.count }));
            return true;
          }
          toast.error(t('scanFab.nameNotFound'), result.query);
          return false;
        }}
      />
    </div>
  );
}
