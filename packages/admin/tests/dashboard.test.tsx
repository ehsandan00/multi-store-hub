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
    inventoryUnits: 980,
    inventoryValue: '12500.00',
    ordersToday: 5,
    revenueToday: '249.50',
    expiringSoonCount: 2,
    pendingMappingReviews: 1,
    failedSyncCount: 1,
    duplicateOnSiteCount: 0,
    activeAlerts: 7,
  },
  alertBreakdown: {
    lowStock: 3,
    expiringSoon: 2,
    failedSyncs: 1,
    pendingMappingReviews: 1,
    duplicateOnSite: 0,
  },
  revenueSeries: [
    { day: '2026-07-04', revenue: '120.00', orders: 2 },
    { day: '2026-07-05', revenue: '49.50', orders: 1 },
  ],
  statusBreakdown: [
    { status: 'completed', count: 40 },
    { status: 'processing', count: 35 },
  ],
  logisticsStatusCounts: {
    SENT: 8,
    NEED_PRODUCT: 3,
    CANCELED: 2,
  },
  topProducts: [
    { productId: 'p1', skuMaster: 'SKU-1', name: 'Alpha', quantity: 12, revenue: '240.00' },
  ],
  lowStockProducts: [
    { id: 'p2', skuMaster: 'SKU-2', name: 'Beta', totalStock: 1, lowStockThreshold: 5, category: 'Snacks' },
  ],
  expiringSoonProducts: [
    { id: 'p3', skuMaster: 'SKU-3', name: 'Gamma', totalStock: 10, expiryDate: '2026-07-12T00:00:00.000Z' },
  ],
  latestSyncs: [
    {
      siteId: 's1',
      siteName: 'Store A',
      syncType: 'product_push',
      status: 'success',
      createdAt: '2026-07-05T08:00:00.000Z',
    },
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
  });

  it('renders the KPI cards from dashboardApi.summary', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText('42')).toBeInTheDocument());
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 8/)).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('لجستیک: ارسال‌شده')).toBeInTheDocument();
    expect(screen.getByText('لجستیک: نیاز به محصول')).toBeInTheDocument();
    expect(screen.getByText('لجستیک: لغوشده')).toBeInTheDocument();
  });

  it('renders the revenue, status breakdown, top products, and recent orders sections', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/درآمد \(۳۰ روز گذشته\)/)).toBeInTheDocument());
    expect(screen.getByText(/وضعیت سفارش \(۳۰ روز\)/)).toBeInTheDocument();
    expect(screen.getByText(/پرفروش‌ترین محصولات \(۳۰ روز\)/)).toBeInTheDocument();
    expect(screen.getByText(/سفارش‌های اخیر/)).toBeInTheDocument();
  });

  it('renders recent orders with site name and status', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getAllByText('Store A').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/در حال پردازش/).length).toBeGreaterThan(0);
  });

  it('renders latest sync status section', async () => {
    renderDashboard();
    await waitFor(() => expect(screen.getByText(/آخرین وضعیت همگام‌سازی/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('product_push')).toBeInTheDocument());
  });
});
