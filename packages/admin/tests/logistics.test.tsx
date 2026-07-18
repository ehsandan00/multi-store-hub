import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../src/lib/toast';
import { LogisticsPage } from '../src/pages/Logistics/Index';
import { logisticsOrdersApi, productsApi } from '../src/lib/api';
import type { LogisticsOrderRow, ProductRow } from '../src/lib/types';

vi.mock('../src/components/logistics/LogisticsProductPicker', () => ({
  LogisticsProductPicker: ({ onSelect }: { onSelect: (product: ProductRow) => void }) => (
    <button type="button" onClick={() => onSelect(product)}>
      انتخاب محصول آزمایشی
    </button>
  ),
}));

vi.mock('../src/components/products/BarcodeScannerModal', () => ({
  BarcodeScannerModal: ({
    open,
    onScan,
  }: {
    open: boolean;
    onScan: (value: string, meta: { source: 'barcode' }) => unknown;
  }) =>
    open ? (
      <button type="button" onClick={() => onScan('123456', { source: 'barcode' })}>
        نتیجه اسکن
      </button>
    ) : null,
}));

const product: ProductRow = {
  id: '11111111-1111-4111-8111-111111111111',
  skuMaster: 'SKU-1',
  name: 'محصول آزمایشی',
  description: null,
  category: null,
  basePrice: '100',
  expiryDate: null,
  expiryBatches: [],
  totalStock: 10,
  lowStockThreshold: 0,
  imageUrl: null,
  hasHubPhoto: false,
  barcode: '123456',
  productType: 'SIMPLE',
  parentId: null,
  parentSku: null,
  parentName: null,
  variationAttributes: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const created: LogisticsOrderRow = {
  id: 'order-id',
  orderNumber: 'LG-20260714-ABC123',
  receiverName: 'علی',
  phone: '09120000000',
  city: 'تهران',
  status: 'SENT',
  createdByUserId: 'user-id',
  employeeId: 'employee-id',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  itemCount: 1,
  employee: {
    id: 'employee-id',
    fullName: 'کارمند آزمایشی',
    email: 'employee@hub.local',
    role: 'WAREHOUSE_STAFF',
  },
  items: [
    {
      id: 'item-id',
      logisticsOrderId: 'order-id',
      productId: product.id,
      productName: product.name,
      skuMaster: product.skuMaster,
      quantity: 1,
    },
  ],
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <LogisticsPage />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('LogisticsPage', () => {
  beforeEach(() => {
    vi.spyOn(logisticsOrdersApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    });
    vi.spyOn(logisticsOrdersApi, 'employees').mockResolvedValue([
      {
        id: 'employee-id',
        fullName: 'کارمند آزمایشی',
        email: 'employee@hub.local',
        role: 'WAREHOUSE_STAFF',
      },
    ]);
    vi.spyOn(logisticsOrdersApi, 'create').mockResolvedValue(created);
    vi.spyOn(logisticsOrdersApi, 'updateStatus').mockResolvedValue(created);
    vi.spyOn(productsApi, 'lookup').mockResolvedValue(product);
  });

  it('shows validation errors for required quick-entry fields', async () => {
    renderPage();

    const submit = screen.getByRole('button', { name: 'ثبت سفارش' });
    fireEvent.submit(submit.closest('form')!);

    expect(await screen.findByText('نام گیرنده الزامی است')).toBeInTheDocument();
    expect(screen.getByText('شماره تلفن الزامی است')).toBeInTheDocument();
    expect(screen.getByText('شهر الزامی است')).toBeInTheDocument();
    expect(screen.getByText('انتخاب کارمند الزامی است')).toBeInTheDocument();
    expect(screen.getByText('حداقل یک محصول اضافه کنید')).toBeInTheDocument();
  });

  it('repeated barcode scans increase the existing product quantity', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: 'اسکن' }));
    await user.click(screen.getByRole('button', { name: 'نتیجه اسکن' }));
    await user.click(screen.getByRole('button', { name: 'اسکن' }));
    await user.click(screen.getByRole('button', { name: 'نتیجه اسکن' }));

    expect(await screen.findByDisplayValue('2')).toBeInTheDocument();
    expect(productsApi.lookup).toHaveBeenCalledTimes(2);
  });

  it('submits multiple fields and resets for the next order', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/نام گیرنده/), 'علی');
    await user.type(screen.getByLabelText(/شماره تلفن/), '09120000000');
    await user.type(screen.getByLabelText(/شهر/), 'تهران');
    await user.selectOptions(screen.getByLabelText(/کارمند مسئول/), 'employee-id');
    await user.click(screen.getByRole('button', { name: 'انتخاب محصول آزمایشی' }));
    await user.click(screen.getByRole('button', { name: 'ثبت سفارش' }));

    await waitFor(() =>
      expect(logisticsOrdersApi.create).toHaveBeenCalledWith({
        employeeId: 'employee-id',
        receiverName: 'علی',
        phone: '09120000000',
        city: 'تهران',
        status: 'SENT',
        items: [{ productId: product.id, quantity: 1 }],
      }),
    );
    await waitFor(() => expect(screen.getByLabelText(/نام گیرنده/)).toHaveValue(''));
    expect(screen.getByText('هنوز محصولی اضافه نشده است')).toBeInTheDocument();
  });
});
