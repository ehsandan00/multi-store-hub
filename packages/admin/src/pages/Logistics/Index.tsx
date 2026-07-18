import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { logisticsOrdersApi, productsApi, toApiError } from '../../lib/api';
import type {
  LogisticsOrderStatus,
  ProductRow,
} from '../../lib/types';
import { useToast } from '../../lib/toast';
import { Button } from '../../components/ui/Button';
import { Input, Select } from '../../components/ui/Field';
import { Badge } from '../../components/ui/Badge';
import { Spinner } from '../../components/ui/Spinner';
import { LogisticsProductPicker } from '../../components/logistics/LogisticsProductPicker';
import { BarcodeScannerModal } from '../../components/products/BarcodeScannerModal';
import { formatDateTime } from '../../lib/utils';

type CartLine = {
  product: ProductRow;
  quantity: number;
};

const STATUSES: LogisticsOrderStatus[] = ['SENT', 'NEED_PRODUCT', 'CANCELED'];

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function statusTone(status: LogisticsOrderStatus): 'green' | 'amber' | 'red' {
  if (status === 'SENT') return 'green';
  if (status === 'NEED_PRODUCT') return 'amber';
  return 'red';
}

export function LogisticsPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const receiverRef = useRef<HTMLInputElement>(null);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const [receiverName, setReceiverName] = useState('');
  const [phone, setPhone] = useState('');
  const [city, setCity] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState<LogisticsOrderStatus>('SENT');
  const [lines, setLines] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [scanOpen, setScanOpen] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'' | LogisticsOrderStatus>('');
  const debouncedSearch = useDebouncedValue(search, 300);

  const listQuery = useQuery({
    queryKey: ['logistics-orders', debouncedSearch, statusFilter],
    queryFn: () =>
      logisticsOrdersApi.list({
        search: debouncedSearch.trim() || undefined,
        status: statusFilter || undefined,
        page: 1,
        pageSize: 25,
      }),
  });
  const employeesQuery = useQuery({
    queryKey: ['logistics-orders', 'employees'],
    queryFn: () => logisticsOrdersApi.employees(),
    staleTime: 60_000,
  });

  const itemCount = useMemo(
    () => lines.reduce((sum, line) => sum + line.quantity, 0),
    [lines],
  );

  function addProduct(product: ProductRow) {
    setLines((current) => {
      const found = current.find((line) => line.product.id === product.id);
      if (found) {
        return current.map((line) =>
          line.product.id === product.id
            ? { ...line, quantity: line.quantity + 1 }
            : line,
        );
      }
      return [...current, { product, quantity: 1 }];
    });
    setErrors((current) => ({ ...current, items: '' }));
    toast.success(t('logistics.productAdded'), product.name);
  }

  async function addByCode(rawCode: string): Promise<boolean> {
    const code = rawCode.trim();
    if (!code || lookupBusy) return false;
    setLookupBusy(true);
    try {
      const product = await productsApi.lookup(code);
      addProduct(product);
      setBarcode('');
      window.setTimeout(() => barcodeRef.current?.focus(), 0);
      return true;
    } catch {
      toast.error(t('logistics.barcodeNotFound'), code);
      return false;
    } finally {
      setLookupBusy(false);
    }
  }

  function updateQuantity(productId: string, quantity: number) {
    if (quantity <= 0) {
      setLines((current) => current.filter((line) => line.product.id !== productId));
      return;
    }
    setLines((current) =>
      current.map((line) => (line.product.id === productId ? { ...line, quantity } : line)),
    );
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!receiverName.trim()) next.receiverName = t('logistics.validation.receiverRequired');
    if (!phone.trim()) next.phone = t('logistics.validation.phoneRequired');
    if (!city.trim()) next.city = t('logistics.validation.cityRequired');
    if (!employeeId) next.employeeId = t('logistics.validation.employeeRequired');
    if (lines.length === 0) next.items = t('logistics.validation.productRequired');
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function resetForm() {
    setReceiverName('');
    setPhone('');
    setCity('');
    setEmployeeId('');
    setStatus('SENT');
    setLines([]);
    setBarcode('');
    setErrors({});
    window.setTimeout(() => receiverRef.current?.focus(), 0);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      logisticsOrdersApi.create({
        employeeId,
        receiverName: receiverName.trim(),
        phone: phone.trim(),
        city: city.trim(),
        status,
        items: lines.map((line) => ({
          productId: line.product.id,
          quantity: line.quantity,
        })),
      }),
    onSuccess: (created) => {
      toast.success(t('logistics.created'), created.orderNumber);
      queryClient.invalidateQueries({ queryKey: ['logistics-orders'] });
      resetForm();
    },
    onError: (error) =>
      toast.error(t('logistics.createFailed'), toApiError(error).message),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, nextStatus }: { id: string; nextStatus: LogisticsOrderStatus }) =>
      logisticsOrdersApi.updateStatus(id, nextStatus),
    onSuccess: () => {
      toast.success(t('logistics.statusUpdated'));
      queryClient.invalidateQueries({ queryKey: ['logistics-orders'] });
    },
    onError: (error) =>
      toast.error(t('logistics.statusUpdateFailed'), toApiError(error).message),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (validate()) createMutation.mutate();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-slate-900 sm:text-2xl">
          {t('logistics.title')}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t('logistics.subtitle')}</p>
      </div>

      <form onSubmit={submit} className="card space-y-5 p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Input
            ref={receiverRef}
            id="logistics-receiver"
            label={t('logistics.receiverName')}
            required
            autoFocus
            value={receiverName}
            error={errors.receiverName}
            onChange={(event) => setReceiverName(event.target.value)}
          />
          <Input
            id="logistics-phone"
            label={t('logistics.phone')}
            required
            inputMode="tel"
            dir="ltr"
            value={phone}
            error={errors.phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          <Input
            id="logistics-city"
            label={t('logistics.city')}
            required
            value={city}
            error={errors.city}
            onChange={(event) => setCity(event.target.value)}
          />
          <Select
            id="logistics-employee"
            label={t('logistics.employee')}
            required
            value={employeeId}
            error={errors.employeeId}
            disabled={employeesQuery.isLoading || createMutation.isPending}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            <option value="">
              {employeesQuery.isLoading
                ? t('logistics.loadingEmployees')
                : t('logistics.employeePlaceholder')}
            </option>
            {employeesQuery.data?.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.fullName} — {employee.email}
              </option>
            ))}
          </Select>
          <Select
            id="logistics-status"
            label={t('logistics.status')}
            required
            value={status}
            onChange={(event) => setStatus(event.target.value as LogisticsOrderStatus)}
          >
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {t(`logistics.statuses.${value}`)}
              </option>
            ))}
          </Select>
        </div>

        <div className="rounded-xl border border-brand-100 bg-brand-50/40 p-3 sm:p-4">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <LogisticsProductPicker onSelect={addProduct} disabled={createMutation.isPending} />
            <div>
              <label htmlFor="logistics-barcode" className="label">
                {t('logistics.barcode')}
              </label>
              <div className="flex gap-2">
                <input
                  ref={barcodeRef}
                  id="logistics-barcode"
                  className="input min-w-0 flex-1 font-mono"
                  value={barcode}
                  placeholder={t('logistics.barcodePlaceholder')}
                  onChange={(event) => setBarcode(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void addByCode(barcode);
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="secondary"
                  loading={lookupBusy}
                  onClick={() => void addByCode(barcode)}
                >
                  {t('logistics.add')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setScanOpen(true)}>
                  {t('logistics.scan')}
                </Button>
              </div>
            </div>
          </div>
          {errors.items && <p className="mt-2 text-xs text-rose-600">{errors.items}</p>}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">{t('logistics.products')}</h2>
            <span className="text-xs text-slate-500">
              {t('logistics.itemCount', { count: itemCount })}
            </span>
          </div>
          {lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 py-8 text-center text-sm text-slate-400">
              {t('logistics.emptyCart')}
            </div>
          ) : (
            <div className="space-y-2">
              {lines.map((line) => (
                <div
                  key={line.product.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{line.product.name}</p>
                    <p className="font-mono text-xs text-slate-500">{line.product.skuMaster}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={t('logistics.decrease')}
                      onClick={() => updateQuantity(line.product.id, line.quantity - 1)}
                    >
                      −
                    </Button>
                    <input
                      aria-label={t('logistics.quantity')}
                      type="number"
                      min="1"
                      max="9999"
                      className="input w-16 px-2 text-center"
                      value={line.quantity}
                      onChange={(event) =>
                        updateQuantity(line.product.id, Math.max(1, Number(event.target.value)))
                      }
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      aria-label={t('logistics.increase')}
                      onClick={() => updateQuantity(line.product.id, line.quantity + 1)}
                    >
                      +
                    </Button>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-rose-600"
                    onClick={() => updateQuantity(line.product.id, 0)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button
            type="button"
            variant="secondary"
            disabled={createMutation.isPending}
            onClick={resetForm}
          >
            {t('logistics.clear')}
          </Button>
          <Button type="submit" loading={createMutation.isPending}>
            {t('logistics.saveOrder')}
          </Button>
        </div>
      </form>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{t('logistics.recentTitle')}</h2>
            <p className="text-xs text-slate-500">{t('logistics.recentSubtitle')}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Input
              aria-label={t('logistics.search')}
              type="search"
              value={search}
              placeholder={t('logistics.searchPlaceholder')}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              aria-label={t('logistics.statusFilter')}
              className="input"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as '' | LogisticsOrderStatus)
              }
            >
              <option value="">{t('logistics.allStatuses')}</option>
              {STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`logistics.statuses.${value}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t('logistics.orderNumber')}</th>
                <th>{t('logistics.receiverName')}</th>
                <th>{t('logistics.phone')}</th>
                <th>{t('logistics.city')}</th>
                <th>{t('logistics.employee')}</th>
                <th>{t('logistics.products')}</th>
                <th>{t('logistics.status')}</th>
                <th>{t('logistics.createdAt')}</th>
              </tr>
            </thead>
            <tbody>
              {listQuery.isLoading && (
                <tr>
                  <td colSpan={8} className="py-8 text-center">
                    <Spinner className="mx-auto h-5 w-5" />
                  </td>
                </tr>
              )}
              {listQuery.isError && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-rose-600">
                    {t('logistics.loadFailed', { message: toApiError(listQuery.error).message })}
                  </td>
                </tr>
              )}
              {!listQuery.isLoading && listQuery.data?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-slate-400">
                    {t('logistics.noOrders')}
                  </td>
                </tr>
              )}
              {listQuery.data?.data.map((order) => (
                <tr key={order.id}>
                  <td className="font-mono text-xs">{order.orderNumber}</td>
                  <td className="font-medium">{order.receiverName}</td>
                  <td dir="ltr" className="text-end font-mono text-xs">{order.phone}</td>
                  <td>{order.city}</td>
                  <td className="text-sm">{order.employee?.fullName ?? t('common.emDash')}</td>
                  <td>
                    <div className="max-w-xs text-xs text-slate-600">
                      {order.items.map((item) => `${item.productName} × ${item.quantity}`).join('، ')}
                    </div>
                  </td>
                  <td>
                    <div className="flex min-w-36 items-center gap-2">
                      <Badge tone={statusTone(order.status)}>
                        {t(`logistics.statuses.${order.status}`)}
                      </Badge>
                      <select
                        aria-label={t('logistics.quickStatus')}
                        className="input py-1 text-xs"
                        value={order.status}
                        disabled={statusMutation.isPending}
                        onChange={(event) =>
                          statusMutation.mutate({
                            id: order.id,
                            nextStatus: event.target.value as LogisticsOrderStatus,
                          })
                        }
                      >
                        {STATUSES.map((value) => (
                          <option key={value} value={value}>
                            {t(`logistics.statuses.${value}`)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-500">
                    {formatDateTime(order.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <BarcodeScannerModal
        open={scanOpen}
        onClose={() => setScanOpen(false)}
        onScan={async (value, meta) => {
          if (meta?.source === 'ocr') {
            toast.info(t('logistics.barcodeOnly'));
            return false;
          }
          return addByCode(value);
        }}
      />
    </div>
  );
}
