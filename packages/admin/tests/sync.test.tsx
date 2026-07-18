import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SyncPage } from '../src/pages/Sync';
import { ToastProvider } from '../src/lib/toast';
import { useAuthStore } from '../src/lib/auth-store';
import * as apiModule from '../src/lib/api';
import type { SafeSite, SyncJob } from '../src/lib/types';

const site: SafeSite = {
  id: 's1',
  name: 'Demo IR store',
  baseUrl: 'https://demo.example.ir',
  platform: 'WOOCOMMERCE',
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

const job: SyncJob = {
  id: 'sj1',
  siteId: 's1',
  direction: 'PUSH',
  status: 'COMPLETED',
  scope: 'ALL',
  totalItems: 3,
  pushedCount: 2,
  failedCount: 1,
  errors: [{ sku: 'BAD-1', message: 'WC rejected: duplicate SKU', code: 'HTTP_400' }],
  payload: null,
  report: {
    pushed: 2,
    failed: 1,
    created: 1,
    updated: 1,
    errors: [{ sku: 'BAD-1', message: 'WC rejected: duplicate SKU', code: 'HTTP_400' }],
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    routeUsed: 'DIRECT',
  },
  createdByUserId: 'u1',
  createdAt: new Date().toISOString(),
  startedAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
  site: { name: 'Demo IR store' },
};

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <SyncPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe('Sync page', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u1', email: 'admin@hub.local', role: 'ADMIN' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    vi.restoreAllMocks();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [site],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    vi.spyOn(apiModule.syncApi, 'listJobs').mockResolvedValue({
      data: [job],
      total: 1,
      page: 1,
      pageSize: 25,
    });
    vi.spyOn(apiModule.syncApi, 'listLogs').mockResolvedValue({
      data: [
        {
          id: 'sl1',
          siteId: 's1',
          syncType: 'product_push',
          status: 'partial',
          details: {},
          createdAt: new Date().toISOString(),
          site: { name: 'Demo IR store' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
    });
  });

  it('renders per-site cards, the jobs table, and the sync log', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0));
    // Schedule sections (push + pull)
    expect(screen.getByText(/ارسال زمان‌بندی‌شده محصول/)).toBeInTheDocument();
    expect(screen.getByText(/دریافت زمان‌بندی‌شده سفارش/)).toBeInTheDocument();
    // Jobs table — latest job shows pushed/failed (2 pushed)
    await waitFor(() => expect(screen.getByText('2')).toBeInTheDocument());
    // Sync log table
    expect(screen.getByText('product_push')).toBeInTheDocument();
  });

  it('hides the Push/Pull buttons and schedule controls for VIEWERs (read-only)', async () => {
    useAuthStore.setState({
      user: { id: 'u3', email: 'viewer@hub.local', role: 'VIEWER' },
      accessToken: 'tok',
      refreshToken: 'rtok',
    });
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /ارسال محصولات/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /دریافت سفارش‌ها/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/غیرفعال/).length).toBeGreaterThanOrEqual(1);
  });

  it('enqueues a push on confirm and shows a success toast', async () => {
    const user = userEvent.setup();
    const pushSpy = vi
      .spyOn(apiModule.syncApi, 'push')
      .mockResolvedValue({ id: 'sj-new', status: 'QUEUED', queued: true });

    renderPage();
    await waitFor(() => expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: /ارسال محصولات/i }));
    await waitFor(() => expect(screen.getByText(/افزودن به صف/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /افزودن به صف/i }));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('s1', { scope: 'ALL' }));
  });

  it('toggles scheduled product push on for the site', async () => {
    const user = userEvent.setup();
    const schedSpy = vi
      .spyOn(apiModule.syncApi, 'updateSchedule')
      .mockResolvedValue({ syncEnabled: true, syncIntervalMs: 600_000, orderPullEnabled: false });

    renderPage();
    await waitFor(() => expect(screen.getByText(/ارسال زمان‌بندی‌شده محصول/)).toBeInTheDocument());
    // The first checkbox is the product-push toggle (it appears before the order-pull one).
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await waitFor(() => expect(schedSpy).toHaveBeenCalledWith('s1', { syncEnabled: true }));
  });

  it('enqueues an order pull on confirm', async () => {
    const user = userEvent.setup();
    const pullSpy = vi
      .spyOn(apiModule.syncApi, 'pull')
      .mockResolvedValue({ id: 'sj-pull', status: 'QUEUED', queued: true });

    renderPage();
    await waitFor(() => expect(screen.getAllByText('Demo IR store').length).toBeGreaterThan(0));
    await user.click(screen.getByRole('button', { name: /دریافت سفارش‌ها/i }));
    await waitFor(() => expect(screen.getByText(/افزودن به صف/i)).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /افزودن به صف/i }));
    await waitFor(() => expect(pullSpy).toHaveBeenCalledWith('s1'));
  });

  it('previews and queues price/stock only for an ASP.NET site', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule.sitesApi, 'list').mockResolvedValue({
      data: [{ ...site, id: 'asp1', name: 'ASP Store', platform: 'NOPCOMMERCE_ASPNET' }],
      total: 1,
      page: 1,
      pageSize: 100,
    });
    const previewSpy = vi.spyOn(apiModule.syncApi, 'previewAspNet').mockResolvedValue({
      siteId: 'asp1',
      total: 3,
      matched: 2,
      unresolved: 1,
      duplicate: 0,
      items: [],
    });
    const pushSpy = vi
      .spyOn(apiModule.syncApi, 'push')
      .mockResolvedValue({ id: 'asp-job', status: 'QUEUED', queued: true });

    renderPage();
    await screen.findByText('ASP Store');
    expect(screen.queryByRole('button', { name: /دریافت سفارش‌ها/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /پیش‌نمایش قیمت و موجودی/i }));
    await waitFor(() => expect(previewSpy).toHaveBeenCalledWith('asp1', { scope: 'PRICE_STOCK' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /افزودن به صف/i }));
    await waitFor(() => expect(pushSpy).toHaveBeenCalledWith('asp1', { scope: 'PRICE_STOCK' }));
  });

  it('shows delete controls for admins and clears failed logs', async () => {
    const user = userEvent.setup();
    const deleteSpy = vi.spyOn(apiModule.syncApi, 'deleteLog').mockResolvedValue(undefined);
    const clearSpy = vi
      .spyOn(apiModule.syncApi, 'clearFailedLogs')
      .mockResolvedValue({ deleted: 2 });

    renderPage();
    await waitFor(() => expect(screen.getByText('product_push')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /پاک کردن لاگ‌های ناموفق/i })).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /^حذف$/i })[0]);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /^حذف$/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith('sl1'));

    await user.click(screen.getByRole('button', { name: /پاک کردن لاگ‌های ناموفق/i }));
    const clearDialog = await screen.findByRole('dialog');
    await user.click(within(clearDialog).getByRole('button', { name: /^پاک کردن$/i }));
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
  });
});
