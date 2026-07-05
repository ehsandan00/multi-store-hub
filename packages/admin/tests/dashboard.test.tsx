import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Dashboard } from '../src/pages/Dashboard';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';
import type { DashboardSummary } from '../src/lib/types';

const summary: DashboardSummary = {
  kpis: {
    totalProducts: 42,
    lowStockCount: 3,
    totalSites: 8,
    activeSites: 6,
    totalOrders: 120,
    ordersLast30d: 75,
  },
  revenueSeries: [
    { day: '2026-07-04', revenue: '120.00', orders: 2 },
    { day: '2026-07-05', revenue: '49.50', orders: 1 },
  ],
  statusBreakdown: [
    { status: 'completed', count: 40 },
    { status: 'processing', count: 35 },
  ],
  topProducts: [
    { productId: 'p1', skuMaster: 'SKU-1', name: 'Alpha', quantity: 12, revenue: '240.00' },
  ],
  lowStockProducts: [
    { id: 'p2', skuMaster: 'SKU-2', name: 'Beta', totalStock: 1, lowStockThreshold: 5, category: 'Snacks' },
  ],
  recentOrders: [
    {
      id: 'o1',
      orderNumber: '1001',
      siteId: 's1',
      siteName: 'Store A',
      status: 'processing',
      totalAmount: '49.50',
      dateCreated: '2026-07-05T10:00:00.000Z',
    },
  ],
  since: '2026-06-05T10:00:00.000Z',
};

function renderDashboard() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <Dashboard />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Dashboard (Phase 4 aggregated summary)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    vi.spyOn(apiModule.dashboardApi, 'summary').mockResolvedValue(summary);
    // The dashboard still renders the upcoming-expiries widget which calls productsApi.list.
    vi.spyOn(apiModule.productsApi, 'list').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 200,
      totalPages: 0,
    });
  });

  it('renders the KPI cards from dashboardApi.summary', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 8/)).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });

  it('renders the revenue, status breakdown, top products, and recent orders sections', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Revenue (last 30 days)')).toBeInTheDocument());
    expect(screen.getByText('Order status (last 30d)')).toBeInTheDocument();
    expect(screen.getByText('Top products (by qty, last 30d)')).toBeInTheDocument();
    expect(screen.getByText('Recent orders')).toBeInTheDocument();
  });

  it('renders recent orders with site name and status', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getAllByText('Store A').length).toBeGreaterThan(0));
    // 'processing' appears in both the status breakdown and the recent orders row.
    expect(screen.getAllByText('processing').length).toBeGreaterThan(0);
  });

  it('renders low-stock products with the low badge', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Beta')).toBeInTheDocument());
    expect(screen.getByText('low')).toBeInTheDocument();
  });
});
