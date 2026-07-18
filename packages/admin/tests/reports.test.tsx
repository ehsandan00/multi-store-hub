import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReportsPage } from '../src/pages/Reports';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';

function renderReports() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ReportsPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('ReportsPage (Phase 6)', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [{ id: 's1', name: 'Store A' } as any],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(apiModule.reportsApi, 'inventory').mockResolvedValue({
      data: [
        {
          id: 'p1',
          skuMaster: 'SKU-1',
          name: 'Alpha',
          category: 'Snacks',
          basePrice: '10.00',
          totalStock: 2,
          lowStockThreshold: 5,
          expiryDate: null,
          isLowStock: true,
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
    });
    vi.spyOn(apiModule.reportsApi, 'expiry').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
      dateFrom: '2026-07-05T00:00:00.000Z',
      dateTo: '2026-08-04T23:59:59.999Z',
    });
    vi.spyOn(apiModule.reportsApi, 'sales').mockResolvedValue({
      groupBy: 'site',
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
      filters: { siteId: null, dateFrom: null, dateTo: null, productId: null },
    });
    vi.spyOn(apiModule.reportsApi, 'sync').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    });
    vi.spyOn(apiModule.reportsApi, 'customers').mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      totalPages: 0,
    });
  });

  it('renders inventory report rows by default', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeInTheDocument());
    expect(screen.getByText('SKU-1')).toBeInTheDocument();
  });

  it('switches to the sales tab', async () => {
    const user = userEvent.setup();
    renderReports();
    await user.click(screen.getByRole('button', { name: /فروش/ }));
    await waitFor(() => expect(apiModule.reportsApi.sales).toHaveBeenCalled());
  });
});
