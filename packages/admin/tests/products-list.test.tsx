import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductsList } from '../src/pages/Products/List';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';

function renderList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ProductsList />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Products list', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [{ id: 's1', name: 'Demo Store', baseUrl: 'https://x.ir', consumerKeyMasked: 'k', consumerSecretMasked: 's', networkRoute: 'DIRECT', isActive: true, syncEnabled: false, syncIntervalMs: 600000, lastSyncAt: null, orderPullEnabled: false, lastOrderPullAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
  });

  it('renders rows from the API and shows total count', async () => {
    vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [
        {
          id: 'p1',
          skuMaster: 'SKU-0001',
          name: 'Almonds 500g',
          description: null,
          category: 'Snacks',
          basePrice: '12.50',
          expiryDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 60).toISOString(),
          totalStock: 240,
          lowStockThreshold: 50,
          hasHubPhoto: false,
          expiryBatches: [],
          barcode: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.productsApi, 'categories').mockResolvedValue(['Snacks']);

    renderList();

    await waitFor(() => expect(screen.getByText('Almonds 500g')).toBeInTheDocument());
    expect(screen.getByText('SKU-0001')).toBeInTheDocument();
    expect(screen.getByText(/نمایش 1 تا 1 از 1/)).toBeInTheDocument();
  });

  it('passes the low-stock filter to the API when the checkbox is toggled', async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.productsApi, 'categories').mockResolvedValue([]);

    renderList();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());

    const checkbox = screen.getByLabelText(/فقط کم‌موجود/i) as HTMLInputElement;
    await user.click(checkbox);

    await waitFor(() => {
      const lastCall = listSpy.mock.calls.at(-1)?.[0];
      expect(lastCall?.lowStock).toBe(true);
    });
  });

  it('passes site catalog view to the API when a store is selected', async () => {
    const user = userEvent.setup();
    const listSpy = vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.productsApi, 'categories').mockResolvedValue([]);

    renderList();
    await waitFor(() => expect(listSpy).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByRole('option', { name: /Demo Store/i })).toBeInTheDocument(),
    );

    await user.selectOptions(screen.getByLabelText(/منبع نمایش/i), 's1');

    await waitFor(() => {
      const lastCall = listSpy.mock.calls.at(-1)?.[0];
      expect(lastCall?.view).toBe('site');
      expect(lastCall?.siteId).toBe('s1');
    });
  });

  it('opens the edit modal when Edit is clicked', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [
        {
          id: 'p1',
          skuMaster: 'SKU-0001',
          name: 'Almonds 500g',
          description: null,
          category: 'Snacks',
          basePrice: '12.50',
          expiryDate: null,
          totalStock: 240,
          lowStockThreshold: 50,
          hasHubPhoto: false,
          expiryBatches: [],
          barcode: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.productsApi, 'categories').mockResolvedValue([]);
    vi.spyOn(apiModule.productsApi, 'get').mockResolvedValue({
      id: 'p1',
      skuMaster: 'SKU-0001',
      name: 'Almonds 500g',
      description: null,
      category: 'Snacks',
      basePrice: '12.50',
      expiryDate: null,
      totalStock: 240,
      lowStockThreshold: 50,
      imageUrl: null,
      hasHubPhoto: false,
      barcode: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    renderList();
    await waitFor(() => expect(screen.getByText('Almonds 500g')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /ویرایش/i }));
    await waitFor(() => expect(apiModule.productsApi.get).toHaveBeenCalledWith('p1'));
    expect(screen.getByText(/ویرایش SKU-0001/i)).toBeInTheDocument();
  });

  it('shows the “New product” button only for admins', () => {
    vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.productsApi, 'categories').mockResolvedValue([]);

    renderList();
    expect(screen.getByRole('button', { name: /\+ محصول جدید/i })).toBeInTheDocument();
  });
});
