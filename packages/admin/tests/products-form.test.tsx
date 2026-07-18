import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductFormModal } from '../src/pages/Products/Form';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';

function renderForm() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <ProductFormModal open onClose={vi.fn()} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ProductFormModal variable products', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'test-token',
      refreshToken: 'test-refresh',
    });
    vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [
        {
          id: 'parent-1',
          skuMaster: 'TSHIRT-001',
          name: 'T-Shirt',
          description: null,
          category: null,
          basePrice: '0',
          expiryDate: null,
          expiryBatches: [],
          totalStock: 0,
          lowStockThreshold: 0,
          imageUrl: null,
          hasHubPhoto: false,
          barcode: null,
          productType: 'VARIABLE',
          parentId: null,
          parentSku: null,
          parentName: null,
          variationAttributes: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
  });

  it('shows parent picker and variation attributes for variation type', async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/نوع محصول/i), 'VARIATION');
    expect(screen.getByText(/محصول والد/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/ویژگی‌های تنوع/i)).toBeInTheDocument();
  });

  it('creates a variation with parent and attributes', async () => {
    const user = userEvent.setup();
    const createSpy = vi.spyOn(apiModule.productsApi, 'create').mockResolvedValue({
      id: 'new-1',
      skuMaster: 'TSHIRT-RED-L',
      name: 'T-Shirt Red L',
      description: null,
      category: null,
      basePrice: '29.99',
      expiryDate: null,
      expiryBatches: [],
      totalStock: 10,
      lowStockThreshold: 0,
      imageUrl: null,
      hasHubPhoto: false,
      barcode: null,
      productType: 'VARIATION',
      parentId: 'parent-1',
      parentSku: 'TSHIRT-001',
      parentName: 'T-Shirt',
      variationAttributes: { Color: 'Red', Size: 'L' },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderForm();
    await user.selectOptions(screen.getByLabelText(/نوع محصول/i), 'VARIATION');
    await user.click(screen.getByRole('button', { name: /محصول والد/i }));
    await waitFor(() => expect(screen.getByText('T-Shirt')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /T-Shirt/i }));
    await user.type(screen.getByLabelText(/SKU اصلی/i), 'TSHIRT-RED-L');
    await user.type(screen.getByRole('textbox', { name: /نام/i }), 'T-Shirt Red L');
    await user.type(screen.getByLabelText(/ویژگی‌های تنوع/i), 'Color:Red|Size:L');
    await user.clear(screen.getByLabelText(/قیمت پایه/i));
    await user.type(screen.getByLabelText(/قیمت پایه/i), '29.99');
    await user.clear(screen.getByLabelText(/موجودی کل/i));
    await user.type(screen.getByLabelText(/موجودی کل/i), '10');
    await user.click(screen.getByRole('button', { name: /ایجاد محصول/i }));

    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          skuMaster: 'TSHIRT-RED-L',
          productType: 'VARIATION',
          parentId: 'parent-1',
          variationAttributes: { Color: 'Red', Size: 'L' },
        }),
      ),
    );
  });
});
