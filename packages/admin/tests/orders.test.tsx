import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrdersList } from '../src/pages/Orders/List';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';
import type { OrderRow, OrderDetail, PaginatedOrders, SafeSite } from '../src/lib/types';

const site: SafeSite = {
  id: 's1',
  name: 'Store A',
  baseUrl: 'https://a.example',
  consumerKeyMasked: '••••key1',
  consumerSecretMasked: '••••sec1',
  networkRoute: 'DIRECT',
  isActive: true,
  syncEnabled: false,
  syncIntervalMs: 600_000,
  lastSyncAt: null,
  orderPullEnabled: false,
  lastOrderPullAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const order: OrderRow = {
  id: 'o1',
  orderNumber: '1001',
  siteId: 's1',
  customerId: 'c1',
  status: 'processing',
  totalAmount: '49.50',
  remoteOrderId: 1001,
  dateCreated: '2026-07-05T10:00:00.000Z',
  dateModified: '2026-07-05T10:00:00.000Z',
  currency: 'USD',
  paymentMethod: 'card',
  discountTotal: '0',
  shippingTotal: '5.00',
  billingName: 'Jane Doe',
  billingEmail: 'jane@example.com',
  billingPhone: '555-0100',
  createdAt: '2026-07-05T10:00:00.000Z',
  updatedAt: '2026-07-05T10:00:00.000Z',
  site: { id: 's1', name: 'Store A' },
  customer: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com' },
};

const page: PaginatedOrders = {
  data: [order],
  total: 1,
  page: 1,
  pageSize: 25,
  totalPages: 1,
};

const detail: OrderDetail = {
  ...order,
  items: [
    {
      id: 'oi1',
      orderId: 'o1',
      productId: 'p1',
      quantity: 2,
      unitPrice: '20.00',
      remoteLineId: '1',
      siteSku: 'SKU-p1',
      lineName: 'Alpha',
      product: { id: 'p1', skuMaster: 'SKU-p1', name: 'Alpha' },
    },
  ],
  site: { id: 's1', name: 'Store A', baseUrl: 'https://a.example' },
  customer: { id: 'c1', name: 'Jane Doe', email: 'jane@example.com', phone: '555-0100' },
};

function renderList() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <OrdersList />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Orders list page', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    vi.spyOn(apiModule.ordersApi, 'list').mockResolvedValue(page);
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [site],
      total: 1,
      page: 1,
      pageSize: 100,
    });
  });

  it('renders the orders table with order #, site, customer, status, total', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    // 'Store A' appears in both the site filter dropdown and the table row.
    expect(screen.getAllByText('Store A').length).toBeGreaterThan(0);
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // 'در حال پردازش' appears in both the status filter dropdown and the status badge.
    expect(screen.getAllByText('در حال پردازش').length).toBeGreaterThan(0);
    expect(screen.getByText(/49\.50/)).toBeInTheDocument();
  });

  it('renders the filter bar (search, site, status, date range, reset)', async () => {
    renderList();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    expect(screen.getByPlaceholderText(/شماره سفارش، نام، ایمیل/i)).toBeInTheDocument();
    expect(screen.getByText('همه فروشگاه‌ها')).toBeInTheDocument();
    expect(screen.getByText('همه وضعیت‌ها')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /بازنشانی/i })).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no orders', async () => {
    vi.spyOn(apiModule.ordersApi, 'list').mockResolvedValue({ ...page, data: [], total: 0 });
    renderList();
    await waitFor(() =>
      expect(screen.getByText(/سفارشی یافت نشد/i)).toBeInTheDocument(),
    );
  });

  it('opens a detail modal with line items when a row is clicked', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.ordersApi, 'get').mockResolvedValue(detail);
    renderList();
    await waitFor(() => expect(screen.getByText('1001')).toBeInTheDocument());
    await user.click(screen.getByText('1001'));
    await waitFor(() => expect(screen.getByText('اقلام')).toBeInTheDocument());
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('SKU-p1')).toBeInTheDocument();
  });
});
